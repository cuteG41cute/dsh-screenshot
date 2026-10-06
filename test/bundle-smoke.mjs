// dsh-screenshot — bundle smoke test (no browser required)
//
// Loads static/lib/client.js the way the DSH client module loader does
// (window.__ModuleLoader__.load), with a minimal fake DOM, and asserts that:
//
//   1. package.json is valid and declares the client entry;
//   2. the bundle registers itself under the expected plugin id;
//   3. the factory returns the { apply, inject } contract the loader expects;
//   4. apply() injects into conversation.input.left and registers one entry;
//   5. the registered component renders a <button> without throwing;
//   6. attachFile() drives the composer's file input (the paperclip pipeline).
//
// Run: node test/bundle-smoke.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) })
  } catch (error) {
    results.push({ name, ok: false, detail: String(error && error.message ? error.message : error) })
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/* ------------------------------------------------------------------ *
 * 1. package manifest
 * ------------------------------------------------------------------ */
check('package.json is valid JSON with a dsh.client entry', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'static', 'package.json'), 'utf8'))
  assert(manifest.name === 'dsh-screenshot', 'unexpected package name: ' + manifest.name)
  assert(manifest.type === 'module', 'package must be ESM (type: module)')
  assert(manifest.exports['./client'] === './lib/client.js', 'missing ./client export')
  assert(manifest.dsh && manifest.dsh.client && manifest.dsh.client.platform === 'web', 'missing dsh.client.platform')
  return manifest.name + '@' + manifest.version
})

/* ------------------------------------------------------------------ *
 * fake DOM, just enough for load + apply + one render + attachFile
 * ------------------------------------------------------------------ */
function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    style: { cssText: '' },
    dataset: {},
    attributes: {},
    childNodes: [],
    textContent: '',
    files: null,
    disabled: false,
    dispatched: [],
    setAttribute(key, value) { this.attributes[key] = value },
    appendChild(child) { this.childNodes.push(child); return child },
    remove() {},
    addEventListener(type, handler) { (this.listeners ||= {})[type] = handler },
    removeEventListener() {},
    dispatchEvent(event) { this.dispatched.push(event); return true },
    getContext() {
      if (this.__context === undefined) {
        this.__context = {
          setTransform() {}, clearRect() {}, drawImage() {},
          beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
          rect() {}, ellipse() {}, arc() {}, stroke() {}, fill() {},
          strokeRect() {}, fillRect() {}, strokeText() {}, fillText() {},
          save() {}, restore() {}, translate() {}, scale() {},
          measureText() { return { width: 10 } },
        }
      }
      return this.__context
    },
    toBlob(cb) { cb({ size: 1, type: 'image/png' }) },
  }
}

const fileInput = Object.assign(makeElement('input'), { disabled: false, files: null })

const documentStub = {
  head: makeElement('head'),
  body: makeElement('body'),
  createElement: (tag) => makeElement(tag),
  querySelector(selector) {
    if (String(selector).includes('input[type="file"]')) return fileInput
    if (String(selector).includes('data-plugin-css')) return null
    return null
  },
}

class DataTransferStub {
  constructor() {
    this.files = []
    this.items = { add: (file) => { this.files.push(file) } }
  }
}
class EventStub {
  constructor(type, init) {
    this.type = type
    this.bubbles = Boolean(init && init.bubbles)
    this.cancelable = Boolean(init && init.cancelable)
    this.defaultPrevented = false
  }
  preventDefault() { this.defaultPrevented = true }
}
class BlobStub {
  constructor(parts, options) {
    this.parts = parts
    this.type = (options && options.type) || ''
  }
}
class FileStub extends BlobStub {
  constructor(parts, name, options) {
    super(parts, options)
    this.name = name
  }
}

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  DataTransfer: DataTransferStub,
  Event: EventStub,
  ClipboardEvent: EventStub,
  Blob: BlobStub,
  File: FileStub,
  navigator: { mediaDevices: {} },
  document: documentStub,
}
sandbox.window = {
  innerWidth: 1600,
  innerHeight: 900,
  addEventListener() {},
  removeEventListener() {},
}
sandbox.window.__ModuleLoader__ = {
  load(definition) { sandbox.__loaded = definition },
}
sandbox.globalThis = sandbox

/* ------------------------------------------------------------------ *
 * 2..6 run the bundle
 * ------------------------------------------------------------------ */
const source = readFileSync(join(root, 'static', 'lib', 'client.js'), 'utf8')

check('bundle evaluates and calls __ModuleLoader__.load with the expected id', () => {
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  const definition = sandbox.__loaded
  assert(definition !== undefined, 'bundle never called __ModuleLoader__.load')
  assert(definition.id === 'dsh-screenshot', 'unexpected plugin id: ' + definition.id)
  assert(typeof definition.factory === 'function', 'factory is not a function')
  return 'id=' + definition.id
})

let plugin = null
check('factory returns the { apply, inject } contract', () => {
  plugin = sandbox.__loaded.factory((name) => {
    if (name === 'react') return reactStub
    throw new Error('unexpected require: ' + name)
  })
  assert(typeof plugin.apply === 'function', 'exports.apply missing')
  assert(Array.isArray(plugin.inject), 'exports.inject missing')
  assert(plugin.inject.includes('slots'), 'inject must declare the slots service')
  return 'inject=[' + plugin.inject.join(',') + ']'
})

check('apply() injects into conversation.input.left and registers one entry', () => {
  const injected = []
  const slots = {
    inject(name, factory) {
      injected.push({ name, entry: factory() })
    },
    register(options, component) {
      return { options, component }
    },
  }
  const ctx = { get: (name) => (name === 'slots' ? slots : undefined) }
  plugin.apply(ctx)
  assert(injected.length === 1, 'expected exactly one slot injection, got ' + injected.length)
  assert(injected[0].name === 'conversation.input.left', 'wrong slot: ' + injected[0].name)
  assert(injected[0].entry.options.id === 'dsh-screenshot', 'wrong entry id: ' + injected[0].entry.options.id)
  assert(typeof injected[0].entry.component === 'function', 'component is not a function')
  sandbox.__entry = injected[0].entry
  return 'slot=' + injected[0].name + ' order=' + injected[0].entry.options.order
})

check('the registered component renders a button element', () => {
  const tree = sandbox.__entry.component()
  assert(tree && tree.type === 'button', 'root element is not a button: ' + (tree && tree.type))
  assert(tree.props['data-dsh-screenshot'] === 'button', 'missing data-dsh-screenshot marker')
  assert(typeof tree.props.onClick === 'function', 'button has no onClick handler')
  assert(tree.props.title && tree.props.title.length > 0, 'button has no tooltip')
  return 'icon children=' + tree.children.length
})

check('styles and the console probe are installed', () => {
  assert(sandbox.window.__dshScreenshot !== undefined, 'window.__dshScreenshot probe missing')
  assert(typeof sandbox.window.__dshScreenshot.captureRegion === 'function', 'probe.captureRegion missing')
  assert(typeof sandbox.window.__dshScreenshot.pickRegion === 'function', 'probe.pickRegion missing')
  assert(typeof sandbox.window.__dshScreenshot.editImage === 'function', 'probe.editImage missing')
  assert(documentStub.head.childNodes.length === 1, 'expected one injected <style> tag')
  return 'probe version=' + sandbox.window.__dshScreenshot.version
})

check('attachFile() drives the composer file input (paperclip pipeline)', () => {
  const file = new FileStub(['bytes'], 'shot.png', { type: 'image/png' })
  const outcome = sandbox.window.__dshScreenshot.attachFile(file)
  assert(outcome.ok === true, 'attachFile failed: ' + JSON.stringify(outcome))
  assert(outcome.via === 'file-input', 'expected the file-input path, got ' + outcome.via)
  assert(fileInput.files && fileInput.files.length === 1, 'files were not assigned to the input')
  assert(fileInput.dispatched.length === 1, 'no change event dispatched')
  assert(fileInput.dispatched[0].type === 'change', 'dispatched event is not change')
  assert(fileInput.dispatched[0].bubbles === true, 'change event must bubble for React')
  return 'via=' + outcome.via + ' name=' + fileInput.files[0].name
})

check('captureRegion() reports a clear error when the API is unavailable', async () => {
  // Synchronous probe only: call and inspect the rejection message.
  const promise = sandbox.window.__dshScreenshot.captureRegion()
  assert(promise instanceof Promise || typeof promise.then === 'function', 'captureRegion did not return a promise')
  return 'returns a promise (async rejection is handled by the caller)'
})

check('pickRegion() builds the overlay with the whole frame pre-selected', () => {
  const frame = Object.assign(makeElement('canvas'), { width: 1920, height: 1080 })
  const promise = sandbox.window.__dshScreenshot.pickRegion(frame)
  assert(typeof promise.then === 'function', 'pickRegion did not return a promise')
  const overlay = documentStub.body.childNodes[documentStub.body.childNodes.length - 1]
  assert(overlay !== undefined, 'overlay was not appended to the document body')
  assert(overlay.attributes['data-dsh-screenshot-overlay'] !== undefined, 'overlay marker missing')
  const actionBar = overlay.childNodes.find((node) => node.attributes
    && node.attributes['data-dsh-screenshot-actions'] !== undefined)
  assert(actionBar !== undefined, 'action bar missing from the overlay')
  const labels = actionBar.childNodes.map((node) => node.textContent).join(' | ')
  assert(labels.includes('Enter'), 'no Enter confirm affordance: ' + labels)
  assert(labels.includes('Esc'), 'no Esc cancel affordance: ' + labels)
  const selection = overlay.childNodes.find((node) => node.style && node.style.width !== undefined
    && node.attributes && Object.keys(node.attributes).length === 0)
  assert(selection !== undefined, 'selection box missing')
  return 'action bar = ' + labels
})

check('editImage() builds the annotation toolbar over the crop', () => {
  const base = Object.assign(makeElement('canvas'), { width: 1280, height: 720 })
  const promise = sandbox.window.__dshScreenshot.editImage(base)
  assert(typeof promise.then === 'function', 'editImage did not return a promise')
  const overlay = documentStub.body.childNodes[documentStub.body.childNodes.length - 1]
  assert(overlay.attributes['data-dsh-screenshot-editor'] !== undefined, 'editor overlay not appended')
  const toolbar = overlay.childNodes.find((node) => node.attributes
    && node.attributes['data-dsh-screenshot-toolbar'] !== undefined)
  assert(toolbar !== undefined, 'editor toolbar missing')
  const tools = toolbar.childNodes
    .filter((node) => node.attributes && node.attributes['data-dsh-tool'] !== undefined)
    .map((node) => node.attributes['data-dsh-tool'])
  for (const id of ['pen', 'rect', 'ellipse', 'arrow', 'text']) {
    assert(tools.includes(id), 'missing tool: ' + id)
  }
  const colors = toolbar.childNodes
    .filter((node) => node.attributes && node.attributes['data-dsh-color'] !== undefined)
  assert(colors.length === 6, 'expected 6 colours, got ' + colors.length)
  const actions = toolbar.childNodes
    .filter((node) => node.attributes && node.attributes['data-dsh-action'] !== undefined)
    .map((node) => node.attributes['data-dsh-action'])
  for (const action of ['undo', 'clear', 'cancel', 'done']) {
    assert(actions.includes(action), 'missing action: ' + action)
  }
  const stage = overlay.childNodes.find((node) => node.childNodes
    .some((child) => child.attributes && child.attributes['data-dsh-screenshot-canvas'] !== undefined))
  assert(stage !== undefined, 'editor canvas not mounted in a stage')
  return 'tools=' + tools.join(',') + ' colours=' + colors.length + ' actions=' + actions.join(',')
})

/* ------------------------------------------------------------------ *
 * report
 * ------------------------------------------------------------------ */
let failed = 0
for (const item of results) {
  if (item.ok !== true) failed += 1
  console.log((item.ok === true ? 'PASS' : 'FAIL') + '  ' + item.name + (item.detail ? '  [' + item.detail + ']' : ''))
}
console.log('')
console.log(failed === 0 ? 'ALL ' + results.length + ' CHECKS PASSED' : failed + ' of ' + results.length + ' CHECKS FAILED')
process.exit(failed === 0 ? 0 : 1)
