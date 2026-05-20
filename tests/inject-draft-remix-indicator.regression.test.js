const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INJECT_PATH = path.join(__dirname, '..', 'inject.js');

function buildHarness() {
  const src = fs.readFileSync(INJECT_PATH, 'utf8');
  const start = src.indexOf('  function extractDraftRemixTargetId(item) {');
  assert.notEqual(start, -1, 'draft remix snippet start not found');
  const end = src.indexOf('  // Check for pending redo prompt on page load (for remix navigation)', start);
  assert.notEqual(end, -1, 'draft remix snippet end not found');
  const snippet = src.slice(start, end);

  const context = {};
  const bootstrap = `
    const DRAFT_BUTTON_SIZE = 24;
    const DRAFT_BUTTON_MARGIN = 6;
    const DRAFT_BUTTON_SPACING = 4;
    const idToRemixTarget = new Map();
    const idToRemixTargetDraft = new Map();
    const idToPrompt = new Map();

    class FakeNode {
      constructor(tagName) {
        this.tagName = tagName;
        this.className = '';
        this.children = [];
        this.style = {};
        this.attributes = {};
        this.parentNode = null;
        this.innerHTML = '';
        this.title = '';
        this.listeners = new Map();
      }

      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      }

      querySelector(selector) {
        if (!selector.startsWith('.')) return null;
        const className = selector.slice(1);
        const stack = [...this.children];
        while (stack.length) {
          const node = stack.shift();
          if ((node.className || '').split(/\\s+/).includes(className)) return node;
          stack.push(...(node.children || []));
        }
        return null;
      }

      setAttribute(name, value) {
        this.attributes[name] = String(value);
      }

      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
      }

      addEventListener(type, handler) {
        this.listeners.set(type, handler);
      }
    }

    const document = {
      createElement(tagName) {
        return new FakeNode(tagName);
      },
    };

    const sessionStorage = {
      setItem() {},
    };

    const window = {
      location: { href: '' },
    };

    function getComputedStyle() {
      return { position: 'relative' };
    }

${snippet}

    function reset() {
      idToRemixTarget.clear();
      idToRemixTargetDraft.clear();
      idToPrompt.clear();
    }

    globalThis.__draftRemixApi = {
      reset,
      FakeNode,
      extractDraftRemixTargetId,
      applyDraftRemixTargetMetadata,
      isDraftRemix,
      ensureRedoButton,
      getPostTarget: (draftId) => idToRemixTarget.get(draftId) || null,
      getDraftTarget: (draftId) => idToRemixTargetDraft.get(draftId) || null,
      setPrompt: (draftId, prompt) => idToPrompt.set(draftId, prompt),
    };
  `;

  vm.createContext(context);
  vm.runInContext(bootstrap, context, { filename: 'inject-draft-remix-indicator-harness.js' });
  return context.__draftRemixApi;
}

test('extractDraftRemixTargetId supports nested post ids, direct target ids, and fallback post ids', () => {
  const api = buildHarness();

  assert.equal(
    api.extractDraftRemixTargetId({
      creation_config: {
        remix_target_post: {
          post: { id: 's_parent_123' },
        },
      },
    }),
    's_parent_123'
  );

  assert.equal(
    api.extractDraftRemixTargetId({
      creation_config: {
        remix_target_post: { id: 'gen_parent_456' },
      },
    }),
    'gen_parent_456'
  );

  assert.equal(
    api.extractDraftRemixTargetId({ remix_target_post_id: 's_parent_789' }),
    's_parent_789'
  );

  assert.equal(api.extractDraftRemixTargetId({ creation_config: { remix_target_post: null } }), null);
});

test('applyDraftRemixTargetMetadata routes post and draft remix targets into the correct maps', () => {
  const api = buildHarness();
  api.reset();

  assert.equal(
    api.applyDraftRemixTargetMetadata('gen_draft_post', {
      creation_config: {
        remix_target_post: {
          post: { id: 's_parent_post' },
        },
      },
    }),
    's_parent_post'
  );
  assert.equal(api.getPostTarget('gen_draft_post'), 's_parent_post');
  assert.equal(api.isDraftRemix('gen_draft_post'), true);

  assert.equal(
    api.applyDraftRemixTargetMetadata('gen_draft_draft', {
      creation_config: {
        remix_target_post: { id: 'gen_parent_draft' },
      },
    }),
    'gen_parent_draft'
  );
  assert.equal(api.getDraftTarget('gen_draft_draft'), 'gen_parent_draft');
  assert.equal(api.isDraftRemix('gen_draft_draft'), true);
});

test('ensureRedoButton turns blue when remix metadata arrives after the card was already rendered', () => {
  const api = buildHarness();
  api.reset();

  const draftCard = new api.FakeNode('div');
  api.setPrompt('gen_late_remix', 'retro hedgehog oracle');

  const redoButton = api.ensureRedoButton(draftCard, 'gen_late_remix');
  assert.equal(redoButton.style.background, 'rgba(0,0,0,0.75)');
  assert.equal(redoButton.title, 'Redo generation');

  api.applyDraftRemixTargetMetadata('gen_late_remix', {
    creation_config: {
      remix_target_post: {
        post: { id: 's_parent_late' },
      },
    },
  });

  const updatedButton = api.ensureRedoButton(draftCard, 'gen_late_remix');
  assert.equal(updatedButton, redoButton);
  assert.equal(updatedButton.style.background, 'rgba(59,130,246,0.85)');
  assert.equal(updatedButton.style.boxShadow, '0 0 0 1px rgba(255,255,255,0.12) inset');
  assert.equal(updatedButton.title, 'Redo from remix source');
  assert.equal(updatedButton.getAttribute('aria-label'), 'Redo generation (this draft is a remix)');
});
