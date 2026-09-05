// ../shared.ts
var idCounter = 1;
var A = [
  "pretty",
  "large",
  "big",
  "small",
  "tall",
  "short",
  "long",
  "handsome",
  "plain",
  "quaint",
  "clean",
  "elegant",
  "easy",
  "angry",
  "crazy",
  "helpful",
  "mushy",
  "odd",
  "unsightly",
  "adorable",
  "important",
  "inexpensive",
  "cheap",
  "expensive",
  "fancy"
];
var C = [
  "red",
  "yellow",
  "blue",
  "green",
  "pink",
  "brown",
  "purple",
  "brown",
  "white",
  "black",
  "orange"
];
var N = [
  "table",
  "chair",
  "house",
  "bbq",
  "desk",
  "car",
  "pony",
  "cookie",
  "sandwich",
  "burger",
  "pizza",
  "mouse",
  "keyboard"
];
function buildData(count) {
  let data = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${A[i % A.length]} ${C[i % C.length]} ${N[i % N.length]}`
    };
  }
  return data;
}
function get1000Rows() {
  return buildData(1e3);
}
function get10000Rows() {
  return buildData(1e4);
}
function updatedEvery10thRow(data) {
  let newData = data.slice(0);
  for (let i = 0, d = data, len = d.length; i < len; i += 10) {
    newData[i] = { id: data[i].id, label: data[i].label + " !!!" };
  }
  return newData;
}
function swapRows(data) {
  let d = data.slice();
  if (d.length > 998) {
    let tmp = d[1];
    d[1] = d[998];
    d[998] = tmp;
  }
  return d;
}
function remove(data, id) {
  return data.filter((d) => d.id !== id);
}
function sortRows(data, ascending = true) {
  let sorted = data.slice().sort((a, b) => {
    if (ascending) {
      return a.label.localeCompare(b.label);
    } else {
      return b.label.localeCompare(a.label);
    }
  });
  return sorted;
}

// ../../../src/runtime/core/vnode.ts
function createRemixElement(type, props, key) {
  return {
    $rmx: true,
    key,
    props: normalizeElementProps(props),
    type
  };
}
function isRemixElement(node) {
  if (typeof node !== "object" || node === null) return false;
  let type = Reflect.get(node, "type");
  let props = Reflect.get(node, "props");
  return Reflect.get(node, "$rmx") === true && (typeof type === "string" || typeof type === "function") && typeof props === "object" && props !== null;
}
function normalizeElementProps(props) {
  if (!props) return {};
  if (!("mix" in props)) return props;
  if (isNormalizedMix(props.mix)) return props;
  let { mix, ...rest } = props;
  let normalizedMix = normalizeMixValue(mix);
  return normalizedMix === void 0 ? rest : { ...rest, mix: normalizedMix };
}
function isNormalizedMix(mix) {
  if (!Array.isArray(mix) || mix.length === 0) return false;
  for (let i = 0; i < mix.length; i++) {
    let item = mix[i];
    if (!item || Array.isArray(item)) return false;
  }
  return true;
}
function normalizeMixValue(mix) {
  if (!mix) return void 0;
  let normalizedMix = [];
  flattenMixValue(mix, normalizedMix);
  return normalizedMix.length === 0 ? void 0 : normalizedMix;
}
function flattenMixValue(mix, out) {
  if (!mix) return;
  if (!Array.isArray(mix)) {
    out.push(mix);
    return;
  }
  for (let item of mix) {
    flattenMixValue(item, out);
  }
}

// ../../../src/runtime/jsx.ts
function jsx(type, props, key) {
  return createRemixElement(type, props, key);
}

// ../../../src/runtime/typed-event-target.ts
var TypedEventTarget = class extends EventTarget {
};

// ../../../src/runtime/component.ts
function createComponent(config) {
  return new ComponentRuntime(config);
}
var ComponentRuntime = class {
  frame;
  #config;
  #connectedController;
  #contextValue;
  #handle;
  #props = {};
  #renderController;
  #renderFn;
  #removed = false;
  // The schedule target is stored as fields (updated each render) rather than
  // a closure so re-renders don't allocate a new function per component.
  #updateQueue;
  #updateVNode;
  #updateParent;
  #scheduleUpdate = () => {
    let queue = this.#updateQueue;
    if (!queue) throw new Error("scheduleUpdate not implemented");
    let vnode = this.#updateVNode;
    let updateParent = this.#updateParent;
    if (!vnode || !updateParent) throw new Error("scheduleUpdate target not initialized");
    queue.enqueue(vnode, updateParent);
  };
  #tasks = [];
  constructor(config) {
    this.#config = config;
    this.frame = config.frame;
    this.#handle = this.#createHandle();
  }
  render = (nextProps) => {
    if (this.#removed) {
      console.warn("render called after component was removed, potential application memory leak");
      return [null, []];
    }
    this.#abortRenderSignal();
    syncProps(this.#props, nextProps);
    let renderFn = this.#renderFn;
    if (renderFn === void 0) {
      let initialize = this.#config.type;
      let result = initialize(this.#handle);
      if (!isRenderFn(result)) {
        let name2 = this.#config.type.name || "Anonymous";
        throw new Error(`${name2} must return a render function, received ${typeof result}`);
      }
      renderFn = result;
      this.#renderFn = renderFn;
    }
    return [renderFn(), this.#dequeueTasks()];
  };
  remove = () => {
    if (this.#removed) return EMPTY_TASKS;
    this.#removed = true;
    this.#connectedController?.abort();
    this.#abortRenderSignal();
    if (this.#tasks.length === 0) return EMPTY_TASKS;
    return this.#dequeueTasks(sharedAbortedSignal ??= AbortSignal.abort());
  };
  // Settles work that was waiting on a render which will not happen, so an
  // awaited handle.update() cannot hang when the render is abandoned. The
  // component stays mounted; only the abandoned render's lifetime ends.
  releasePendingTasks = () => {
    if (this.#removed) return EMPTY_TASKS;
    this.#abortRenderSignal();
    if (this.#tasks.length === 0) return EMPTY_TASKS;
    return this.#dequeueTasks(sharedAbortedSignal ??= AbortSignal.abort());
  };
  setScheduleUpdate = (queue, vnode, updateParent) => {
    this.#updateQueue = queue;
    this.#updateVNode = vnode;
    this.#updateParent = updateParent;
  };
  getContextValue = () => this.#contextValue;
  isRemoved = () => this.#removed;
  #createHandle() {
    let component = this;
    let context = {
      set: (value) => {
        this.#contextValue = value;
      },
      get: (type) => isElementFunction(type) ? this.#config.getContext(type) : void 0
    };
    return {
      id: this.#config.id,
      props: this.#props,
      update: () => new Promise((resolve) => {
        if (component.#removed) {
          resolve(AbortSignal.abort());
          return;
        }
        this.#tasks.push((signal) => resolve(signal));
        this.#scheduleUpdate();
      }),
      queueTask: (task) => {
        this.#tasks.push(task);
      },
      frame: this.#config.frame,
      frames: {
        get top() {
          return component.#config.getTopFrame?.() ?? component.#config.frame;
        },
        get(name2) {
          return component.#config.getFrameByName(name2);
        }
      },
      context,
      get signal() {
        return component.#config.signal ?? component.#connectedSignal();
      }
    };
  }
  #connectedSignal() {
    if (this.#removed) return sharedAbortedSignal ??= AbortSignal.abort();
    this.#connectedController ??= new AbortController();
    return this.#connectedController.signal;
  }
  #abortRenderSignal() {
    this.#renderController?.abort();
    this.#renderController = void 0;
  }
  #dequeueTasks(signal) {
    if (this.#tasks.length === 0) return EMPTY_TASKS;
    let needsSignal = signal === void 0 && this.#tasks.some((task) => task.length >= 1);
    if (needsSignal) {
      this.#renderController ??= new AbortController();
    }
    signal ??= this.#renderController?.signal;
    signal ??= sharedAbortedSignal ??= AbortSignal.abort();
    let tasks = this.#tasks.splice(0, this.#tasks.length);
    return tasks.map((task) => () => task(signal));
  }
};
function isRenderFn(value) {
  return typeof value === "function";
}
function isElementFunction(value) {
  return typeof value === "function";
}
var EMPTY_TASKS = [];
var sharedAbortedSignal;
function syncProps(target, next) {
  for (let key in target) {
    if (!(key in next)) {
      delete target[key];
    }
  }
  for (let key in next) {
    target[key] = next[key];
  }
}
function Frame(handle) {
  void handle;
  return () => null;
}
function Fragment(handle) {
  void handle;
  return () => null;
}
function createFrameHandle(def) {
  return Object.assign(
    new TypedEventTarget(),
    {
      src: "/",
      replace: notImplemented("replace not implemented"),
      reload: notImplemented("reload not implemented")
    },
    def
  );
}
function notImplemented(msg) {
  return () => {
    throw new Error(msg);
  };
}

// ../../../src/runtime/error-event.ts
function createComponentErrorEvent(error) {
  return new ErrorEvent("error", { error });
}
function getComponentError(event) {
  return event.error;
}

// ../../../src/runtime/invariant.ts
function invariant(assertion, message) {
  let prefix = "Framework invariant";
  if (assertion) return;
  throw new Error(message ? `${prefix}: ${message}` : prefix);
}

// ../../../src/style/layers.ts
var REMIX_UI_STYLE_LAYER = "rmx";

// ../../../src/style/stylesheet.ts
var SERVER_STYLE_SELECTOR = "style[data-rmx-style]";
function getStyleLayerName(className, layer = REMIX_UI_STYLE_LAYER) {
  return `${layer}.${className}`;
}
function compareNodesInDocumentOrder(a, b) {
  if (a === b) return 0;
  let position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}
function isParentNode(value) {
  return "querySelectorAll" in value;
}
function collectServerStyleTagsFromNode(node, into) {
  if (isHtmlStyleElement(node) && node.matches(SERVER_STYLE_SELECTOR)) {
    into.add(node);
    return;
  }
  if (!(node instanceof Element) && !(node instanceof Document) && !(node instanceof DocumentFragment)) {
    return;
  }
  let nested = node.querySelectorAll?.(SERVER_STYLE_SELECTOR) ?? [];
  for (let i = 0; i < nested.length; i++) {
    let el2 = nested[i];
    if (isHtmlStyleElement(el2)) {
      into.add(el2);
    }
  }
}
function collectServerStyleTags(source) {
  let styles = /* @__PURE__ */ new Set();
  if (isParentNode(source)) {
    collectServerStyleTagsFromNode(source, styles);
  } else {
    for (let node of source) {
      collectServerStyleTagsFromNode(node, styles);
    }
  }
  return Array.from(styles).sort(compareNodesInDocumentOrder);
}
function isHtmlStyleElement(node) {
  return typeof node === "object" && node !== null && node instanceof HTMLStyleElement;
}
function getStyleSelector(styleEl) {
  let selector = styleEl.getAttribute("data-rmx-style")?.trim();
  return selector ? selector : null;
}
function createStyleManager(layer = REMIX_UI_STYLE_LAYER) {
  let stylesheet = null;
  let generation = 0;
  let ruleMap = /* @__PURE__ */ new Map();
  function getStylesheet() {
    if (!stylesheet) {
      stylesheet = new CSSStyleSheet();
      document.adoptedStyleSheets.push(stylesheet);
    }
    return stylesheet;
  }
  function removeStylesheet() {
    if (!stylesheet) return;
    document.adoptedStyleSheets = Array.from(document.adoptedStyleSheets).filter(
      (s) => s !== stylesheet
    );
    stylesheet = null;
  }
  function clearStylesheet() {
    if (!stylesheet) return;
    for (let i = stylesheet.cssRules.length - 1; i >= 0; i--) {
      stylesheet.deleteRule(i);
    }
  }
  function adoptServerStyleTag(styleEl) {
    let selector = getStyleSelector(styleEl);
    if (!selector) return void 0;
    let entry = ruleMap.get(selector);
    if (entry) {
      entry.pinned = true;
      styleEl.remove();
      return selector;
    }
    let cssText = styleEl.textContent?.trim() ?? "";
    if (cssText.length === 0) {
      styleEl.remove();
      return void 0;
    }
    try {
      let sheet = getStylesheet();
      let index = sheet.cssRules.length;
      sheet.insertRule(cssText, index);
      ruleMap.set(selector, { count: 0, index, pinned: true });
      styleEl.remove();
      return selector;
    } catch {
      return void 0;
    }
  }
  function has(className) {
    let entry = ruleMap.get(className);
    return entry !== void 0 && (entry.pinned || entry.count > 0);
  }
  function getGeneration() {
    return generation;
  }
  function insert(className, rule) {
    let entry = ruleMap.get(className);
    if (entry) {
      if (!entry.pinned) entry.count++;
      return;
    }
    let sheet = getStylesheet();
    let index = sheet.cssRules.length;
    sheet.insertRule(`@layer ${getStyleLayerName(className, layer)} { ${rule} }`, index);
    ruleMap.set(className, { count: 1, index, pinned: false });
  }
  function remove2(className) {
    let entry = ruleMap.get(className);
    if (!entry || entry.pinned) return;
    entry.count--;
    if (entry.count > 0) {
      return;
    }
    let indexToDelete = entry.index;
    ruleMap.delete(className);
    if (!stylesheet) return;
    stylesheet.deleteRule(indexToDelete);
    for (let [, data] of ruleMap.entries()) {
      if (data.index > indexToDelete) {
        data.index--;
      }
    }
  }
  function reset() {
    clearStylesheet();
    ruleMap.clear();
    removeStylesheet();
    generation++;
  }
  function adoptServerStyles(source) {
    let styles = collectServerStyleTags(source);
    let adopted = /* @__PURE__ */ new Set();
    for (let styleEl of styles) {
      let selector = adoptServerStyleTag(styleEl);
      if (selector) adopted.add(selector);
    }
    return adopted;
  }
  function selectors() {
    return ruleMap.keys();
  }
  function dispose() {
    removeStylesheet();
    ruleMap.clear();
    generation++;
  }
  return {
    insert,
    remove: remove2,
    has,
    getGeneration,
    reset,
    adoptServerStyles,
    selectors,
    dispose
  };
}

// ../../../src/style/style.ts
var CAMEL_TO_KEBAB_CACHE_LIMIT = 256;
var camelToKebabCache = /* @__PURE__ */ new Map();
function camelToKebab(str) {
  let cached = camelToKebabCache.get(str);
  if (cached === void 0) {
    cached = str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    if (camelToKebabCache.size >= CAMEL_TO_KEBAB_CACHE_LIMIT) {
      let oldest = camelToKebabCache.keys().next();
      if (!oldest.done) camelToKebabCache.delete(oldest.value);
    }
    camelToKebabCache.set(str, cached);
  }
  return cached;
}
var NUMERIC_CSS_PROPS = /* @__PURE__ */ new Set([
  "aspect-ratio",
  "z-index",
  "opacity",
  "flex-grow",
  "flex-shrink",
  "flex-order",
  "grid-area",
  "grid-row",
  "grid-column",
  "font-weight",
  "line-height",
  "order",
  "orphans",
  "widows",
  "zoom",
  "columns",
  "column-count"
]);
function normalizeCssValue(key, value) {
  if (value == null) return String(value);
  if (typeof value === "number" && value !== 0) {
    let cssKey = camelToKebab(key);
    if (!NUMERIC_CSS_PROPS.has(cssKey) && !cssKey.startsWith("--")) {
      return `${value}px`;
    }
  }
  return String(value);
}

// ../../../src/runtime/svg-attributes.ts
var XLINK_NS = "http://www.w3.org/1999/xlink";
var XML_NS = "http://www.w3.org/XML/1998/namespace";
var CANONICAL_CAMEL_SVG_ATTRS = /* @__PURE__ */ new Set([
  "accentHeight",
  "attributeName",
  "attributeType",
  "autoReverse",
  "baseFrequency",
  "baseProfile",
  "calcMode",
  "viewBox",
  "preserveAspectRatio",
  "externalResourcesRequired",
  "filterRes",
  "gradientUnits",
  "gradientTransform",
  "glyphRef",
  "kernelMatrix",
  "kernelUnitLength",
  "keyPoints",
  "keySplines",
  "keyTimes",
  "lengthAdjust",
  "limitingConeAngle",
  "markerHeight",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "markerWidth",
  "numOctaves",
  "pathLength",
  "pointsAtX",
  "pointsAtY",
  "pointsAtZ",
  "preserveAlpha",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "filterUnits",
  "primitiveUnits",
  "refX",
  "refY",
  "requiredExtensions",
  "requiredFeatures",
  "specularConstant",
  "specularExponent",
  "spreadMethod",
  "startOffset",
  "stdDeviation",
  "stitchTiles",
  "surfaceScale",
  "systemLanguage",
  "tableValues",
  "targetX",
  "targetY",
  "textLength",
  "viewTarget",
  "xChannelSelector",
  "yChannelSelector",
  "zoomAndPan",
  "edgeMode",
  "diffuseConstant",
  "markerUnits"
]);
var SVG_ATTR_ALIASES = /* @__PURE__ */ new Map();
for (let attr of CANONICAL_CAMEL_SVG_ATTRS) {
  SVG_ATTR_ALIASES.set(camelToKebab2(attr), attr);
}
var NAMESPACED_SVG_ALIASES = /* @__PURE__ */ new Map([
  ["xlinkHref", { ns: XLINK_NS, attr: "xlink:href" }],
  ["xlink:href", { ns: XLINK_NS, attr: "xlink:href" }],
  ["xlink-href", { ns: XLINK_NS, attr: "xlink:href" }],
  ["xlinkActuate", { ns: XLINK_NS, attr: "xlink:actuate" }],
  ["xlink:actuate", { ns: XLINK_NS, attr: "xlink:actuate" }],
  ["xlink-actuate", { ns: XLINK_NS, attr: "xlink:actuate" }],
  ["xlinkArcrole", { ns: XLINK_NS, attr: "xlink:arcrole" }],
  ["xlink:arcrole", { ns: XLINK_NS, attr: "xlink:arcrole" }],
  ["xlink-arcrole", { ns: XLINK_NS, attr: "xlink:arcrole" }],
  ["xlinkRole", { ns: XLINK_NS, attr: "xlink:role" }],
  ["xlink:role", { ns: XLINK_NS, attr: "xlink:role" }],
  ["xlink-role", { ns: XLINK_NS, attr: "xlink:role" }],
  ["xlinkShow", { ns: XLINK_NS, attr: "xlink:show" }],
  ["xlink:show", { ns: XLINK_NS, attr: "xlink:show" }],
  ["xlink-show", { ns: XLINK_NS, attr: "xlink:show" }],
  ["xlinkTitle", { ns: XLINK_NS, attr: "xlink:title" }],
  ["xlink:title", { ns: XLINK_NS, attr: "xlink:title" }],
  ["xlink-title", { ns: XLINK_NS, attr: "xlink:title" }],
  ["xlinkType", { ns: XLINK_NS, attr: "xlink:type" }],
  ["xlink:type", { ns: XLINK_NS, attr: "xlink:type" }],
  ["xlink-type", { ns: XLINK_NS, attr: "xlink:type" }],
  ["xmlBase", { ns: XML_NS, attr: "xml:base" }],
  ["xml:base", { ns: XML_NS, attr: "xml:base" }],
  ["xml-base", { ns: XML_NS, attr: "xml:base" }],
  ["xmlLang", { ns: XML_NS, attr: "xml:lang" }],
  ["xml:lang", { ns: XML_NS, attr: "xml:lang" }],
  ["xml-lang", { ns: XML_NS, attr: "xml:lang" }],
  ["xmlSpace", { ns: XML_NS, attr: "xml:space" }],
  ["xml:space", { ns: XML_NS, attr: "xml:space" }],
  ["xml-space", { ns: XML_NS, attr: "xml:space" }],
  ["xmlnsXlink", { attr: "xmlns:xlink" }],
  ["xmlns:xlink", { attr: "xmlns:xlink" }],
  ["xmlns-xlink", { attr: "xmlns:xlink" }]
]);
function normalizeSvgAttributeName(name2) {
  let alias = SVG_ATTR_ALIASES.get(name2);
  if (alias) return alias;
  if (CANONICAL_CAMEL_SVG_ATTRS.has(name2)) return name2;
  return camelToKebab2(name2);
}
function normalizeSvgAttribute(name2) {
  let namespaced = NAMESPACED_SVG_ALIASES.get(name2);
  if (namespaced) {
    return namespaced;
  }
  return { attr: normalizeSvgAttributeName(name2) };
}
function camelToKebab2(input) {
  return input.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}

// ../../../src/runtime/core/attributes.ts
var ATTRIBUTE_FALLBACK_NAMES = /* @__PURE__ */ new Set([
  "width",
  "height",
  "href",
  "list",
  "form",
  "tabIndex",
  "download",
  "rowSpan",
  "colSpan",
  "role",
  "popover",
  "translate"
]);
var BOOLEANISH_STRING_ATTRIBUTES = /* @__PURE__ */ new Set([
  "autoReverse",
  "contenteditable",
  "draggable",
  "externalResourcesRequired",
  "focusable",
  "preserveAlpha",
  "spellcheck"
]);
function canUseProperty(element, name2, isSvg, attr) {
  if (isSvg) return false;
  if (ATTRIBUTE_FALLBACK_NAMES.has(name2)) return false;
  if (isBooleanishStringAttribute(attr)) return false;
  return name2 in element;
}
var NORMALIZATION_CACHE_LIMIT = 256;
var htmlAttributeNameCache = /* @__PURE__ */ new Map();
var svgAttributeNameCache = /* @__PURE__ */ new Map();
function normalizeAttributeName(name2, isSvg) {
  let cache = isSvg ? svgAttributeNameCache : htmlAttributeNameCache;
  let cached = cache.get(name2);
  if (cached === void 0) {
    cached = computeAttributeName(name2, isSvg);
    if (cache.size >= NORMALIZATION_CACHE_LIMIT) {
      let oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(name2, cached);
  }
  return cached;
}
function computeAttributeName(name2, isSvg) {
  if (name2.startsWith("aria-") || name2.startsWith("data-")) return { attr: name2 };
  if (name2 === "className") return { attr: "class" };
  if (!isSvg) {
    if (name2 === "htmlFor") return { attr: "for" };
    if (name2 === "tabIndex") return { attr: "tabindex" };
    if (name2 === "acceptCharset") return { attr: "accept-charset" };
    if (name2 === "httpEquiv") return { attr: "http-equiv" };
    return { attr: name2.toLowerCase() };
  }
  return normalizeSvgAttribute(name2);
}
function isBooleanishStringAttribute(name2) {
  return BOOLEANISH_STRING_ATTRIBUTES.has(name2);
}
function serializeStyleObject(style) {
  let parts = [];
  for (let [key, value] of Object.entries(style)) {
    if (value == null) continue;
    if (typeof value === "boolean") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    let cssKey = toKebabCase(key);
    let cssValue = Array.isArray(value) ? value.join(", ") : normalizeCssValue(key, value);
    parts.push(`${cssKey}: ${cssValue};`);
  }
  return parts.join(" ");
}
function getMergedClassName(props) {
  let classAttr = typeof props.class === "string" ? props.class : "";
  let className = typeof props.className === "string" ? props.className : "";
  let merged = classAttr && className ? `${classAttr} ${className}` : classAttr || className;
  return merged || void 0;
}
var kebabCaseCache = /* @__PURE__ */ new Map();
function toKebabCase(value) {
  let cached = kebabCaseCache.get(value);
  if (cached === void 0) {
    cached = value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
    if (kebabCaseCache.size >= NORMALIZATION_CACHE_LIMIT) {
      let oldest = kebabCaseCache.keys().next();
      if (!oldest.done) kebabCaseCache.delete(oldest.value);
    }
    kebabCaseCache.set(value, cached);
  }
  return cached;
}

// ../../../src/runtime/core/props.ts
var SVG_NS = "http://www.w3.org/2000/svg";
function isFrameworkProp(name2) {
  return name2 === "children" || name2 === "mix" || name2 === "key" || name2 === "animate" || name2 === "innerHTML" || name2 === "on";
}
function toLocalName(attrName) {
  let separatorIndex = attrName.indexOf(":");
  if (separatorIndex === -1) return attrName;
  return attrName.slice(separatorIndex + 1);
}
function clearRuntimePropertyOnRemoval(dom, name2) {
  try {
    if (name2 === "value" || name2 === "defaultValue") {
      dom[name2] = "";
      return;
    }
    if (name2 === "checked" || name2 === "defaultChecked" || name2 === "selected") {
      dom[name2] = false;
      return;
    }
    if (name2 === "selectedIndex") {
      dom[name2] = -1;
    }
  } catch {
  }
}
function patchHostProps(curr, next, dom) {
  let isSvg = dom.namespaceURI === SVG_NS;
  let currClassName = getMergedClassName(curr);
  let nextClassName = getMergedClassName(next);
  if (currClassName !== nextClassName) {
    if (nextClassName) {
      dom.setAttribute("class", nextClassName);
    } else {
      dom.removeAttribute("class");
    }
  }
  for (let name2 in curr) {
    if (isFrameworkProp(name2)) continue;
    if (name2 === "class" || name2 === "className") continue;
    if (name2 in next && next[name2] != null) continue;
    let { ns, attr } = normalizeAttributeName(name2, isSvg);
    if (canUseProperty(dom, name2, isSvg, attr)) {
      clearRuntimePropertyOnRemoval(dom, name2);
    }
    if (ns) dom.removeAttributeNS(ns, toLocalName(attr));
    else dom.removeAttribute(attr);
  }
  for (let name2 in next) {
    if (isFrameworkProp(name2)) continue;
    if (name2 === "class" || name2 === "className") continue;
    let nextValue = next[name2];
    if (nextValue == null) continue;
    let prevValue = curr[name2];
    if (prevValue === nextValue) continue;
    if (name2 === "style" && isStyleObject(nextValue)) {
      if (isStyleObject(prevValue)) {
        patchStyleObject(dom, prevValue, nextValue);
      } else {
        dom.removeAttribute("style");
        patchStyleObject(dom, void 0, nextValue);
      }
      continue;
    }
    patchHostProp(dom, name2, nextValue, isSvg);
  }
}
function patchHostProp(dom, name2, value, isSvg) {
  let { ns, attr } = normalizeAttributeName(name2, isSvg);
  if (attr === "style" && isStyleObject(value)) {
    patchStyleObject(dom, void 0, value);
    return;
  }
  if (attr === "style" && typeof value === "string") {
    dom.setAttribute("style", value);
    return;
  }
  if (canUseProperty(dom, name2, isSvg, attr)) {
    try {
      dom[name2] = value == null ? "" : value;
      return;
    } catch {
    }
  }
  if (typeof value === "function") return;
  let isAriaOrData = name2.startsWith("aria-") || name2.startsWith("data-");
  let isBooleanishString = isBooleanishStringAttribute(attr);
  if (value != null && (value !== false || isAriaOrData || isBooleanishString)) {
    let attrValue = name2 === "popover" && value === true ? "" : String(value);
    if (ns) dom.setAttributeNS(ns, attr, attrValue);
    else dom.setAttribute(attr, attrValue);
  } else {
    if (ns) dom.removeAttributeNS(ns, toLocalName(attr));
    else dom.removeAttribute(attr);
  }
}
function isStyleObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function patchStyleObject(dom, curr, next) {
  if (!(dom instanceof HTMLElement || dom instanceof SVGElement)) {
    dom.setAttribute("style", serializeStyleObject(next));
    return;
  }
  let style = dom.style;
  if (curr) {
    for (let name2 in curr) {
      let nextCssValue = styleValueToCss(name2, next[name2]);
      if (nextCssValue !== void 0) continue;
      let prevCssValue = styleValueToCss(name2, curr[name2]);
      if (prevCssValue === void 0) continue;
      style.removeProperty(toKebabCase(name2));
    }
  }
  for (let name2 in next) {
    let nextCssValue = styleValueToCss(name2, next[name2]);
    if (nextCssValue === void 0) continue;
    let prevCssValue = curr ? styleValueToCss(name2, curr[name2]) : void 0;
    if (prevCssValue === nextCssValue) continue;
    style.setProperty(toKebabCase(name2), nextCssValue);
  }
}
function styleValueToCss(name2, value) {
  if (value == null) return void 0;
  if (typeof value === "boolean") return void 0;
  if (typeof value === "number" && !Number.isFinite(value)) return void 0;
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return normalizeCssValue(name2, value);
}

// ../../../src/runtime/diff-props.ts
var globalStyleManager = typeof window !== "undefined" ? createStyleManager() : null;
var defaultStyleManager = globalStyleManager;

// ../../../src/runtime/vnode.ts
var TEXT_NODE = /* @__PURE__ */ Symbol("TEXT_NODE");
var NON_RENDER_NODE = /* @__PURE__ */ Symbol("NON_RENDER_NODE");
var ROOT_VNODE = /* @__PURE__ */ Symbol("ROOT_VNODE");

// ../../../src/runtime/universal/scheduler.ts
var MAX_CASCADING_UPDATES = 50;
var NO_PARENTS = [];
function createUpdateScheduler(config) {
  let scheduled = /* @__PURE__ */ new Map();
  let workTasks = [];
  let commitPhase = [];
  let tasks = [];
  let flushScheduled = false;
  let flushing = false;
  let syncRenderDepth = 0;
  let mutated = false;
  let batchStarted = false;
  let updateCounts = /* @__PURE__ */ new WeakMap();
  let resetScheduled = false;
  let cascadingUpdateCount = 0;
  let cascadingNames = config.reportWarning ? /* @__PURE__ */ new Map() : void 0;
  let phaseEvents = new EventTarget();
  let phaseListenerCounts = { beforeUpdate: 0, commit: 0 };
  let activeParents = NO_PARENTS;
  function beginBatch() {
    if (batchStarted) return;
    batchStarted = true;
    try {
      config.beforeUpdate?.();
    } catch (error) {
      config.reportError(error);
    }
  }
  function finishMutationPhase() {
    if (!batchStarted) return;
    batchStarted = false;
    try {
      config.beforeCommit?.();
    } catch (error) {
      config.reportError(error);
    }
  }
  function scheduleFlush() {
    if (flushScheduled || flushing) return;
    flushScheduled = true;
    queueMicrotask(flush);
  }
  function withinUpdateBudget(entry) {
    let count = (updateCounts.get(entry) ?? 0) + 1;
    updateCounts.set(entry, count);
    if (cascadingNames) {
      let name2 = config.describe(entry);
      cascadingNames.set(name2, (cascadingNames.get(name2) ?? 0) + 1);
      cascadingUpdateCount++;
      if (cascadingUpdateCount === MAX_CASCADING_UPDATES) {
        let names = Array.from(cascadingNames, ([name3, count2]) => `${name3} x${count2}`).join(", ");
        config.reportWarning?.(
          `${cascadingUpdateCount} cascading component updates detected in one event loop turn. Components: ${names}`
        );
      }
    }
    if (!resetScheduled) {
      resetScheduled = true;
      setTimeout(() => {
        updateCounts = /* @__PURE__ */ new WeakMap();
        resetScheduled = false;
        cascadingUpdateCount = 0;
        cascadingNames?.clear();
      }, 0);
    }
    if (count <= MAX_CASCADING_UPDATES) return true;
    config.reportError(
      new Error(
        `handle.update() infinite loop detected in ${config.describe(entry)} after ${count} cascading updates`
      )
    );
    return false;
  }
  function runQueue(queue) {
    if (queue.length === 0) return false;
    for (let index = 0; index < queue.length; index++) {
      try {
        queue[index]();
      } catch (error) {
        config.reportError(error);
      }
    }
    queue.length = 0;
    return true;
  }
  function dispatchPhase(type, parents) {
    if (phaseListenerCounts[type] === 0) return;
    let event = new Event(type);
    event.parents = parents;
    phaseEvents.dispatchEvent(event);
  }
  function pending() {
    return scheduled.size > 0 || workTasks.length > 0 || commitPhase.length > 0 || tasks.length > 0;
  }
  function runUpdates() {
    let batch = new Map(scheduled);
    scheduled.clear();
    mutated = true;
    let stopped = false;
    let failed = false;
    let skipped = null;
    for (let [entry, updateParent] of batch) {
      if (stopped) {
        config.release(entry);
        continue;
      }
      if (config.hasScheduledAncestor(entry, batch)) {
        skipped ??= [];
        skipped.push(entry);
        continue;
      }
      if (!withinUpdateBudget(entry)) {
        config.release(entry);
        stopped = true;
        continue;
      }
      try {
        config.update(entry, updateParent);
      } catch (error) {
        failed = true;
        config.reportError(error);
      }
    }
    if ((failed || stopped) && skipped !== null) {
      for (let index = 0; index < skipped.length; index++) config.release(skipped[index]);
    }
    return stopped;
  }
  function flush() {
    if (flushing || syncRenderDepth > 0) return;
    flushing = true;
    try {
      while (true) {
        flushScheduled = false;
        if (!pending() && !mutated) return;
        beginBatch();
        let parents = scheduled.size > 0 ? Array.from(new Set(scheduled.values())) : NO_PARENTS;
        activeParents = parents;
        dispatchPhase("beforeUpdate", parents);
        let exhausted = scheduled.size > 0 ? runUpdates() : false;
        if (runQueue(workTasks)) mutated = true;
        activeParents = NO_PARENTS;
        finishMutationPhase();
        if (runQueue(commitPhase)) mutated = true;
        if (mutated) {
          mutated = false;
          try {
            config.commit();
          } catch (error) {
            config.reportError(error);
          }
        }
        dispatchPhase("commit", parents);
        runQueue(tasks);
        if (!exhausted) continue;
        for (let entry of scheduled.keys()) config.release(entry);
        scheduled.clear();
        runQueue(workTasks);
        runQueue(commitPhase);
        runQueue(tasks);
        if (pending()) {
          flushScheduled = true;
          queueMicrotask(flush);
        }
        return;
      }
    } finally {
      finishMutationPhase();
      activeParents = NO_PARENTS;
      flushing = false;
    }
  }
  return {
    enqueue(entry, updateParent) {
      scheduled.set(entry, updateParent);
      scheduleFlush();
    },
    enqueueWork(newTasks) {
      if (newTasks.length === 0) return;
      for (let index = 0; index < newTasks.length; index++) workTasks.push(newTasks[index]);
      scheduleFlush();
    },
    enqueueCommitPhase(newTasks) {
      if (newTasks.length === 0) return;
      for (let index = 0; index < newTasks.length; index++) commitPhase.push(newTasks[index]);
      scheduleFlush();
    },
    enqueueTasks(newTasks) {
      if (newTasks.length === 0) return;
      for (let index = 0; index < newTasks.length; index++) tasks.push(newTasks[index]);
      scheduleFlush();
    },
    addEventListener(type, listener, options) {
      phaseEvents.addEventListener(type, listener, options);
      if (listener) phaseListenerCounts[type] += 1;
    },
    removeEventListener(type, listener, options) {
      phaseEvents.removeEventListener(type, listener, options);
      if (listener) phaseListenerCounts[type] = Math.max(0, phaseListenerCounts[type] - 1);
    },
    updateParents() {
      return activeParents;
    },
    runSync(render) {
      mutated = true;
      beginBatch();
      let failure;
      syncRenderDepth++;
      try {
        render();
      } catch (error) {
        failure = { error };
      } finally {
        syncRenderDepth--;
      }
      flush();
      if (failure) throw failure.error;
    },
    flush
  };
}

// ../../../src/runtime/universal/vnode.ts
function findFirstAnchor(target, isAttached) {
  if (!target) return null;
  switch (target.kind) {
    case "host":
      if (target._shared) return null;
      return !isAttached || isAttached(target._node) ? target._node : null;
    case "text":
      return !isAttached || isAttached(target._node) ? target._node : null;
    case "frame":
      return !isAttached || isAttached(target._frame.start) ? target._frame.start : null;
    case "component":
      return findFirstAnchor(target._content, isAttached);
    case "fragment": {
      let children = target._children;
      for (let i = 0; i < children.length; i++) {
        let found = findFirstAnchor(children[i], isAttached);
        if (found) return found;
      }
      return null;
    }
    case "empty":
      return null;
  }
}
function findLastAnchor(target, isAttached) {
  if (!target) return null;
  switch (target.kind) {
    case "host":
      if (target._shared) return null;
      return !isAttached || isAttached(target._node) ? target._node : null;
    case "text":
      return !isAttached || isAttached(target._node) ? target._node : null;
    case "frame":
      return !isAttached || isAttached(target._frame.end) ? target._frame.end : null;
    case "component":
      return findLastAnchor(target._content, isAttached);
    case "fragment": {
      let children = target._children;
      for (let i = children.length - 1; i >= 0; i--) {
        let found = findLastAnchor(children[i], isAttached);
        if (found) return found;
      }
      return null;
    }
    case "empty":
      return null;
  }
}
function findNextSiblingAnchor(target, resolveRootEnd, isAttached) {
  let parent = target._parent;
  if (parent.kind === "component") return findNextSiblingAnchor(parent, resolveRootEnd, isAttached);
  let children = parent._children;
  let index = children.indexOf(target);
  if (index === -1) return null;
  for (let i = index + 1; i < children.length; i++) {
    let found = findFirstAnchor(children[i], isAttached);
    if (found) return found;
  }
  if (parent.kind === "fragment") return findNextSiblingAnchor(parent, resolveRootEnd, isAttached);
  if (parent.kind === "root" && resolveRootEnd) return resolveRootEnd(parent);
  return null;
}
function findContextValue(parent, type) {
  let current = parent;
  while (current) {
    if (current.kind === "component" && current.type === type) {
      return current._handle.getContextValue();
    }
    current = current.kind === "root" ? void 0 : current._parent;
  }
  return void 0;
}
function hasScheduledAncestor(target, batch) {
  let current = target._parent;
  while (current) {
    if (current.kind === "component" && batch.has(current)) return true;
    current = current.kind === "root" ? void 0 : current._parent;
  }
  return false;
}

// ../../../src/runtime/universal/batch.ts
function createRendererScheduler(options = {}) {
  let pendingCommits = /* @__PURE__ */ new Set();
  let committing = /* @__PURE__ */ new Set();
  let reportError = options.reportError ?? reportUnhandledError;
  let scheduler = createUpdateScheduler({
    update(target, parent) {
      let context = target._context;
      context.reconciler.updateComponent(target, parent, context);
    },
    release(target) {
      let context = target._context;
      context.reconciler.releaseComponent(target, context);
    },
    hasScheduledAncestor,
    describe(target) {
      return target.type.name || "Anonymous";
    },
    beforeUpdate: options.beforeUpdate,
    beforeCommit: options.beforeCommit,
    reportWarning: options.reportWarning,
    commit() {
      let previous = committing;
      committing = pendingCommits;
      pendingCommits = previous;
      try {
        for (let commit of committing) {
          try {
            commit();
          } catch (error) {
            reportError(error);
          }
        }
      } finally {
        committing.clear();
      }
    },
    reportError
  });
  return Object.assign(scheduler, {
    markDirty(commit) {
      pendingCommits.add(commit);
    }
  });
}
function reportUnhandledError(error) {
  setTimeout(() => {
    throw error;
  }, 0);
}

// ../../../src/runtime/core/keyed-children.ts
function hasKeyedChildren(children) {
  for (let i = 0; i < children.length; i++) {
    if (children[i].key != null) return true;
  }
  return false;
}
function warnDuplicateKeys(children) {
  let seenKeys;
  let duplicateKeys;
  for (let node of children) {
    if (node.key == null) continue;
    if (!seenKeys) {
      seenKeys = /* @__PURE__ */ new Set([node.key]);
      continue;
    }
    if (seenKeys.has(node.key)) {
      duplicateKeys ??= /* @__PURE__ */ new Set();
      duplicateKeys.add(node.key);
    } else {
      seenKeys.add(node.key);
    }
  }
  if (duplicateKeys?.size) {
    let quotedKeys = Array.from(duplicateKeys, (key) => `"${String(key)}"`);
    console.warn(
      `Duplicate keys detected in siblings: ${quotedKeys.join(", ")}. Keys should be unique.`
    );
  }
}
function matchKeyedChildren(curr, next) {
  let matches = matchKeyedChildrenInOrder(curr, next) ?? matchKeyedChildrenAfterSingleRemoval(curr, next) ?? matchKeyedChildrenAfterPairSwap(curr, next);
  if (matches) return matches;
  warnDuplicateKeys(next);
  return matchKeyedChildrenByKeyMap(curr, next);
}
function matchKeyedChildrenByKeyMap(curr, next) {
  let oldKeyMap = /* @__PURE__ */ new Map();
  let usedOldIndexes = /* @__PURE__ */ new Set();
  let unkeyedSearchStart = 0;
  for (let index = 0; index < curr.length; index++) {
    let key = curr[index].key;
    if (key != null) oldKeyMap.set(key, index);
  }
  let matches = [];
  for (let nextIndex = 0; nextIndex < next.length; nextIndex++) {
    let nextNode = next[nextIndex];
    let oldIndex = -1;
    if (nextNode.key != null) {
      let keyedOldIndex = oldKeyMap.get(nextNode.key);
      if (keyedOldIndex !== void 0) {
        let oldNode = curr[keyedOldIndex];
        if (!usedOldIndexes.has(keyedOldIndex) && oldNode.type === nextNode.type) {
          oldIndex = keyedOldIndex;
        }
      }
    } else {
      for (let index = unkeyedSearchStart; index < curr.length; index++) {
        let oldNode = curr[index];
        if (usedOldIndexes.has(index) || oldNode.key != null || oldNode.type !== nextNode.type) {
          continue;
        }
        oldIndex = index;
        unkeyedSearchStart = index + 1;
        break;
      }
    }
    if (oldIndex >= 0) usedOldIndexes.add(oldIndex);
    matches.push(oldIndex);
  }
  return matches;
}
function matchKeyedChildrenInOrder(curr, next) {
  let length = Math.min(curr.length, next.length);
  let matches = [];
  for (let index = 0; index < length; index++) {
    let nextNode = next[index];
    if (nextNode.key == null) return null;
    let oldNode = curr[index];
    if (oldNode.key !== nextNode.key || oldNode.type !== nextNode.type) {
      return null;
    }
    matches.push(index);
  }
  for (let index = length; index < next.length; index++) {
    if (next[index].key == null) return null;
    matches.push(-1);
  }
  return matches;
}
function matchKeyedChildrenAfterSingleRemoval(curr, next) {
  if (curr.length !== next.length + 1) return null;
  let matches = [];
  let oldIndex = 0;
  let skippedOldNode = false;
  for (let nextIndex = 0; nextIndex < next.length; nextIndex++) {
    let nextNode = next[nextIndex];
    if (nextNode.key == null) return null;
    let oldNode = curr[oldIndex];
    if (oldNode.key === nextNode.key && oldNode.type === nextNode.type) {
      matches.push(oldIndex);
      oldIndex++;
      continue;
    }
    if (skippedOldNode) return null;
    skippedOldNode = true;
    oldIndex++;
    oldNode = curr[oldIndex];
    if (oldNode.key !== nextNode.key || oldNode.type !== nextNode.type) {
      return null;
    }
    matches.push(oldIndex);
    oldIndex++;
  }
  return matches;
}
function matchKeyedChildrenAfterPairSwap(curr, next) {
  if (curr.length !== next.length) return null;
  let matches = [];
  let firstMismatch = -1;
  let secondMismatch = -1;
  for (let index = 0; index < next.length; index++) {
    let nextNode = next[index];
    if (nextNode.key == null) return null;
    let oldNode = curr[index];
    if (oldNode.key === nextNode.key && oldNode.type === nextNode.type) {
      matches.push(index);
      continue;
    }
    if (firstMismatch === -1) {
      firstMismatch = index;
    } else if (secondMismatch === -1) {
      secondMismatch = index;
    } else {
      return null;
    }
    matches.push(-1);
  }
  if (firstMismatch === -1) return matches;
  if (secondMismatch === -1) return null;
  let firstOldNode = curr[firstMismatch];
  let secondOldNode = curr[secondMismatch];
  let firstNextNode = next[firstMismatch];
  let secondNextNode = next[secondMismatch];
  if (firstOldNode.key !== secondNextNode.key || firstOldNode.type !== secondNextNode.type || secondOldNode.key !== firstNextNode.key || secondOldNode.type !== firstNextNode.type) {
    return null;
  }
  matches[firstMismatch] = secondMismatch;
  matches[secondMismatch] = firstMismatch;
  return matches;
}
function analyzeKeyedChildMatches(currentLength, matches) {
  let hasRemovals = matches.length !== currentLength;
  let canSkipPlacement = true;
  let lastOldIndex = -1;
  let sawNewNode = false;
  for (let index = 0; index < matches.length; index++) {
    let oldIndex = matches[index];
    if (oldIndex < 0) {
      hasRemovals = true;
      sawNewNode = true;
      continue;
    }
    if (sawNewNode || oldIndex < lastOldIndex) {
      canSkipPlacement = false;
    }
    lastOldIndex = oldIndex;
  }
  return { hasRemovals, canSkipPlacement };
}
function lisMatches(matches) {
  let predecessors = Array.from({ length: matches.length });
  let tails = [];
  for (let index = 0; index < matches.length; index++) {
    let value = matches[index] + 1;
    if (value === 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      let middle = low + high >> 1;
      if (matches[tails[middle]] + 1 < value) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    predecessors[index] = low > 0 ? tails[low - 1] : -1;
    tails[low] = index;
  }
  let cursor = tails.at(-1) ?? -1;
  for (let index = tails.length - 1; index >= 0; index--) {
    tails[index] = cursor;
    cursor = predecessors[cursor] ?? -1;
  }
  return tails;
}

// ../../../src/runtime/mixins/mixin.ts
var mixinHandleId = 0;
function createMixin(type) {
  return (...args) => ({
    type,
    args
  });
}
function resolveMixedProps(input) {
  let state = input.state ?? createMixinRuntimeState();
  let handle = state.handle;
  if (!handle) {
    handle = new MixinHandleImpl({
      id: state.id,
      hostType: input.hostType,
      frame: input.frame,
      scheduler: input.scheduler,
      getContext: input.getContext ?? (() => void 0),
      getRuntimeSignal: () => getMixinRuntimeSignal(state),
      getBinding: () => state.binding
    });
    state.handle = handle;
  } else {
    handle.setScheduler(input.scheduler);
  }
  let hostType = input.hostType;
  let descriptors = resolveMixDescriptors(input.props);
  let composedProps = withoutMix(input.props);
  let mixinProps = withoutMixinTreeProps(composedProps);
  let maxDescriptors = 1024;
  for (let index = 0; index < descriptors.length && index < maxDescriptors; index++) {
    let descriptor = descriptors[index];
    let setup = descriptor.type;
    let entry = state.runners[index];
    if (!entry || entry.type !== setup) {
      if (entry) {
        queueMixinRemove(handle, entry.scope);
      }
      let scope = /* @__PURE__ */ Symbol("mixin-scope");
      handle.setActiveScope(scope);
      entry = {
        scope,
        type: setup,
        runner: normalizeMixinRunner(setup(handle, hostType), handle)
      };
      handle.setActiveScope(void 0);
      state.runners[index] = entry;
      let binding = state.binding;
      if (binding?.node) {
        queueMixinInsert(handle, entry.scope, binding.node, binding.parent, binding.key);
      }
    }
    handle.setActiveScope(entry.scope);
    let result = entry.runner(...descriptor.args, mixinProps);
    handle.setActiveScope(void 0);
    if (!result) continue;
    if (isMixinElement(result)) continue;
    let returnedDescriptors = resolveReturnedMixDescriptors(result);
    if (returnedDescriptors) {
      for (let returned of returnedDescriptors) descriptors.push(returned);
      continue;
    }
    if (!isRemixElement2(result)) {
      console.error(new Error("mixins must return a remix element"));
      continue;
    }
    let resultType = typeof result.type === "string" ? result.type : isMixinElement(result.type) ? result.type.__rmxMixinElementType : null;
    if (resultType !== hostType) {
      console.error(new Error("mixins must return an element with the same host type"));
      continue;
    }
    if (result.type !== resultType) {
      result = { ...result, type: resultType };
    }
    let nextProps = sanitizeReturnedMixinProps(result.props);
    let nestedDescriptors = resolveMixDescriptors(nextProps);
    for (let nested of nestedDescriptors) descriptors.push(nested);
    composedProps = composeMixinProps(composedProps, withoutMix(nextProps));
    mixinProps = withoutMixinTreeProps(composedProps);
  }
  for (let index = descriptors.length; index < state.runners.length; index++) {
    let entry = state.runners[index];
    if (entry) {
      handle.dispatchScopedEvent(entry.scope, new Event("remove"));
      handle.releaseScope(entry.scope);
    }
  }
  if (state.runners.length > descriptors.length) {
    state.runners.length = descriptors.length;
  }
  let nextMix = input.props.mix;
  return {
    state,
    props: {
      ...composedProps,
      ...nextMix === void 0 ? {} : { mix: nextMix }
    }
  };
}
function teardownMixins(state) {
  if (!state) return;
  state.binding = void 0;
  prepareMixinRemoval(state);
  cancelPendingMixinRemoval(state);
  let handle = state.handle;
  if (handle) {
    handle.queueCommitTask(() => finalizeMixinTeardown(state));
    return;
  }
  finalizeMixinTeardown(state);
}
function bindMixinRuntime(state, binding, options) {
  if (!state) return;
  let previousNode = state.binding?.node;
  let nextBinding = binding;
  state.binding = nextBinding;
  let handle = state.handle;
  if (handle && nextBinding) handle.setScheduler(nextBinding.scheduler);
  if (!nextBinding?.node || previousNode === nextBinding.node) return;
  let nextNode = nextBinding.node;
  if (!handle) return;
  for (let entry of state.runners) {
    if (options?.dispatchReclaimed) {
      queueMixinReclaimed(handle, entry.scope, nextNode, nextBinding.parent, nextBinding.key);
    } else {
      queueMixinInsert(handle, entry.scope, nextNode, nextBinding.parent, nextBinding.key);
    }
  }
}
function prepareMixinRemoval(state) {
  if (!state || state.removePrepared) return state?.pendingRemoval?.done;
  state.removePrepared = true;
  let pendingRemoval;
  let persistTeardowns = [];
  let registerPersistNode = (teardown) => {
    persistTeardowns.push(teardown);
  };
  let handle = state.handle;
  if (!handle) return;
  for (let entry of state.runners) {
    dispatchMixinBeforeRemove(handle, entry.scope, registerPersistNode);
  }
  if (persistTeardowns.length > 0) {
    let controller = new AbortController();
    let done = Promise.allSettled(
      persistTeardowns.map((teardown) => Promise.resolve().then(() => teardown(controller.signal)))
    ).then(() => {
    });
    pendingRemoval = {
      signal: controller.signal,
      cancel(reason) {
        controller.abort(reason);
      },
      done
    };
  }
  state.pendingRemoval = pendingRemoval;
  return pendingRemoval?.done;
}
function cancelPendingMixinRemoval(state, reason = new DOMException("", "AbortError")) {
  if (!state?.pendingRemoval) return;
  state.pendingRemoval.cancel(reason);
  state.pendingRemoval = void 0;
  state.removePrepared = false;
}
function createMixinRuntimeState() {
  return {
    id: `m${++mixinHandleId}`,
    aborted: false,
    runners: []
  };
}
var MixinHandleImpl = class extends TypedEventTarget {
  id;
  context;
  frame;
  element;
  #options;
  // The root that renders the element owns its batching, and a retained
  // element can be reclaimed by a root with a different scheduler.
  #scheduler;
  #phaseListenerCounts = {
    beforeUpdate: 0,
    commit: 0
  };
  #activeScope;
  #scopeSignals = /* @__PURE__ */ new Map();
  #scopeTargets = /* @__PURE__ */ new Map();
  #scopePhaseCounts = /* @__PURE__ */ new Map();
  #onSchedulerBeforeUpdate = (event) => {
    this.#dispatchSchedulerPhaseToHandle("beforeUpdate", event);
  };
  #onSchedulerCommit = (event) => {
    this.#dispatchSchedulerPhaseToHandle("commit", event);
  };
  constructor(options) {
    super();
    this.#options = options;
    this.#scheduler = options.scheduler;
    this.id = options.id;
    this.context = {
      get: options.getContext
    };
    this.frame = options.frame;
    let element = ((_, __) => (props) => ({
      $rmx: true,
      type: options.hostType,
      key: null,
      props
    }));
    element.__rmxMixinElementType = options.hostType;
    this.element = element;
  }
  get signal() {
    let scope = this.#activeScope;
    invariant(
      scope,
      "handle.signal is only available during mixin setup, render, or lifecycle callbacks"
    );
    return this.#getScopeSignal(scope);
  }
  addEventListener(type, listener, options) {
    let target = this.#getActiveScopeTarget();
    target.addEventListener(
      type,
      listener,
      options
    );
    if (!listener || !isSchedulerPhaseType(type)) return;
    let scope = this.#activeScope;
    invariant(scope);
    let scopePhaseCounts = this.#scopePhaseCounts.get(scope);
    invariant(scopePhaseCounts);
    scopePhaseCounts[type] += 1;
    this.#phaseListenerCounts[type] += 1;
    if (this.#phaseListenerCounts[type] !== 1) return;
    if (type === "beforeUpdate") {
      this.#scheduler.addEventListener("beforeUpdate", this.#onSchedulerBeforeUpdate);
    } else {
      this.#scheduler.addEventListener("commit", this.#onSchedulerCommit);
    }
  }
  removeEventListener(type, listener, options) {
    let target = this.#getActiveScopeTarget();
    target.removeEventListener(
      type,
      listener,
      typeof options === "boolean" ? { capture: options } : options
    );
    if (!listener || !isSchedulerPhaseType(type)) return;
    let scope = this.#activeScope;
    invariant(scope);
    let scopePhaseCounts = this.#scopePhaseCounts.get(scope);
    invariant(scopePhaseCounts);
    scopePhaseCounts[type] = Math.max(0, scopePhaseCounts[type] - 1);
    this.#phaseListenerCounts[type] = Math.max(0, this.#phaseListenerCounts[type] - 1);
    if (this.#phaseListenerCounts[type] !== 0) return;
    if (type === "beforeUpdate") {
      this.#scheduler.removeEventListener("beforeUpdate", this.#onSchedulerBeforeUpdate);
    } else {
      this.#scheduler.removeEventListener("commit", this.#onSchedulerCommit);
    }
  }
  update() {
    return new Promise((resolve) => {
      let signal = this.#options.getRuntimeSignal();
      if (signal.aborted) {
        resolve(signal);
        return;
      }
      let binding = this.#options.getBinding();
      if (!binding) {
        resolve(signal);
        return;
      }
      binding.enqueueUpdate(resolve);
    });
  }
  queueTask(task) {
    this.#scheduler.enqueueTasks([
      () => {
        let binding = this.#options.getBinding();
        invariant(binding);
        task(binding.node, this.#options.getRuntimeSignal());
      }
    ]);
  }
  queueCommitTask(task) {
    this.#scheduler.enqueueCommitPhase([task]);
  }
  setScheduler(scheduler) {
    if (scheduler === this.#scheduler) return;
    if (this.#phaseListenerCounts.beforeUpdate > 0) {
      this.#scheduler.removeEventListener("beforeUpdate", this.#onSchedulerBeforeUpdate);
      scheduler.addEventListener("beforeUpdate", this.#onSchedulerBeforeUpdate);
    }
    if (this.#phaseListenerCounts.commit > 0) {
      this.#scheduler.removeEventListener("commit", this.#onSchedulerCommit);
      scheduler.addEventListener("commit", this.#onSchedulerCommit);
    }
    this.#scheduler = scheduler;
  }
  setActiveScope(scope) {
    this.#activeScope = scope;
    if (!scope) return;
    if (this.#scopeTargets.has(scope)) return;
    this.#scopeTargets.set(scope, new TypedEventTarget());
    this.#scopePhaseCounts.set(scope, { beforeUpdate: 0, commit: 0 });
  }
  dispatchScopedEvent(scope, event) {
    let previousScope = this.#activeScope;
    this.#activeScope = scope;
    this.#scopeTargets.get(scope)?.dispatchEvent(event);
    this.#activeScope = previousScope;
  }
  releaseScope(scope) {
    let scopePhaseCounts = this.#scopePhaseCounts.get(scope);
    if (scopePhaseCounts) {
      this.#decrementGlobalPhaseCount("beforeUpdate", scopePhaseCounts.beforeUpdate);
      this.#decrementGlobalPhaseCount("commit", scopePhaseCounts.commit);
    }
    let controller = this.#scopeSignals.get(scope);
    if (controller) {
      controller.abort();
      this.#scopeSignals.delete(scope);
    }
    this.#scopePhaseCounts.delete(scope);
    this.#scopeTargets.delete(scope);
    if (this.#activeScope === scope) {
      this.#activeScope = void 0;
    }
  }
  #dispatchSchedulerPhaseToHandle(type, event) {
    let binding = this.#options.getBinding();
    if (!binding) return;
    if (!isBindingInUpdateScope(binding, event.parents)) return;
    for (let [, target] of this.#scopeTargets) {
      let updateEvent = new Event(type);
      updateEvent.node = binding.node;
      target.dispatchEvent(updateEvent);
    }
  }
  #getActiveScopeTarget() {
    let scope = this.#activeScope;
    invariant(scope);
    let target = this.#scopeTargets.get(scope);
    invariant(target);
    return target;
  }
  #getScopeSignal(scope) {
    let controller = this.#scopeSignals.get(scope);
    if (!controller) {
      controller = new AbortController();
      this.#scopeSignals.set(scope, controller);
    }
    return controller.signal;
  }
  #decrementGlobalPhaseCount(type, amount) {
    if (amount <= 0) return;
    this.#phaseListenerCounts[type] = Math.max(0, this.#phaseListenerCounts[type] - amount);
    if (this.#phaseListenerCounts[type] !== 0) return;
    if (type === "beforeUpdate") {
      this.#scheduler.removeEventListener("beforeUpdate", this.#onSchedulerBeforeUpdate);
    } else {
      this.#scheduler.removeEventListener("commit", this.#onSchedulerCommit);
    }
  }
};
function getMixinRuntimeSignal(state) {
  let controller = state.controller;
  if (!controller) {
    controller = new AbortController();
    if (state.aborted) {
      controller.abort();
    }
    state.controller = controller;
  }
  return controller.signal;
}
function dispatchMixinBeforeUpdate(state) {
  dispatchMixinUpdateEvent(state, "beforeUpdate");
}
function dispatchMixinCommit(state) {
  dispatchMixinUpdateEvent(state, "commit");
}
function dispatchMixinInsert(handle, scope, node, parent, key) {
  let event = new Event("insert");
  event.node = node;
  event.parent = parent;
  event.key = key;
  handle.dispatchScopedEvent(scope, event);
}
function dispatchMixinReclaimed(handle, scope, node, parent, key) {
  let event = new Event("reclaimed");
  event.node = node;
  event.parent = parent;
  event.key = key;
  handle.dispatchScopedEvent(scope, event);
}
function dispatchMixinBeforeRemove(handle, scope, persistNode) {
  let event = new Event("beforeRemove");
  event.persistNode = persistNode;
  handle.dispatchScopedEvent(scope, event);
}
function queueMixinInsert(handle, scope, node, parent, key) {
  handle.queueCommitTask(() => {
    dispatchMixinInsert(handle, scope, node, parent, key);
  });
}
function queueMixinReclaimed(handle, scope, node, parent, key) {
  handle.queueCommitTask(() => {
    dispatchMixinReclaimed(handle, scope, node, parent, key);
  });
}
function queueMixinRemove(handle, scope) {
  handle.queueCommitTask(() => {
    handle.dispatchScopedEvent(scope, new Event("remove"));
    handle.releaseScope(scope);
  });
}
function dispatchMixinRemoveEvent(state) {
  let runners = state?.runners;
  if (!runners?.length) return;
  let handle = state?.handle;
  if (!handle) return;
  for (let entry of runners) {
    handle.dispatchScopedEvent(entry.scope, new Event("remove"));
  }
}
function finalizeMixinTeardown(state) {
  dispatchMixinRemoveEvent(state);
  let handle = state.handle;
  if (handle) {
    for (let entry of state.runners) {
      handle.releaseScope(entry.scope);
    }
  }
  state.runners.length = 0;
  state.aborted = true;
  state.controller?.abort();
  state.pendingRemoval = void 0;
  state.removePrepared = true;
  state.handle = void 0;
}
function dispatchMixinUpdateEvent(state, type) {
  let node = state?.binding?.node;
  if (!node) return;
  let runners = state?.runners;
  if (!runners?.length) return;
  let handle = state?.handle;
  if (!handle) return;
  for (let entry of runners) {
    let event = new Event(type);
    event.node = node;
    handle.dispatchScopedEvent(entry.scope, event);
  }
}
function isSchedulerPhaseType(type) {
  return type === "beforeUpdate" || type === "commit";
}
function isBindingInUpdateScope(binding, parents) {
  for (let index = 0; index < parents.length; index++) {
    if (binding.contains(parents[index])) return true;
  }
  return false;
}
function resolveMixDescriptors(props) {
  let mix = props.mix;
  if (!mix) return [];
  if (Array.isArray(mix)) {
    if (mix.length === 0) return [];
    return mix.filter(Boolean);
  }
  return [mix];
}
function withoutMix(props) {
  if (!("mix" in props)) return props;
  let output = { ...props };
  delete output.mix;
  return output;
}
function withoutMixinTreeProps(props) {
  if (!("children" in props) && !("innerHTML" in props)) return props;
  let output = { ...props };
  delete output.children;
  delete output.innerHTML;
  return output;
}
function sanitizeReturnedMixinProps(props) {
  if (!("children" in props) && !("innerHTML" in props)) return props;
  console.error(new Error("mixins must not return children or innerHTML"));
  return withoutMixinTreeProps(props);
}
function composeMixinProps(previous, next) {
  return { ...previous, ...next };
}
function resolveReturnedMixDescriptors(value) {
  let descriptors = [];
  if (!collectReturnedMixDescriptors(value, descriptors)) {
    return null;
  }
  return descriptors;
}
function collectReturnedMixDescriptors(value, output) {
  if (!value) {
    return true;
  }
  if (Array.isArray(value)) {
    for (let item of value) {
      if (!collectReturnedMixDescriptors(item, output)) {
        return false;
      }
    }
    return true;
  }
  if (!isMixinDescriptor(value)) {
    return false;
  }
  output.push(value);
  return true;
}
function isRemixElement2(value) {
  if (!value || typeof value !== "object") return false;
  return value.$rmx === true;
}
function isMixinDescriptor(value) {
  if (!value || typeof value !== "object" || isRemixElement2(value)) {
    return false;
  }
  let descriptor = value;
  return typeof descriptor.type === "function" && Array.isArray(descriptor.args);
}
function isMixinElement(value) {
  if (typeof value !== "function") return false;
  return "__rmxMixinElementType" in value;
}
function normalizeMixinRunner(result, handle) {
  if (typeof result === "function" && !isMixinElement(result)) {
    return result;
  }
  if (result === void 0) {
    return () => handle.element;
  }
  return () => result;
}

// ../../../src/runtime/core/children.ts
function isEmptyChild(value) {
  return value == null || typeof value === "boolean";
}
function isPrimitiveChild(value) {
  let type = typeof value;
  return type === "string" || type === "number" || type === "bigint";
}
function normalizeChildren(children) {
  for (let i = 0; i < children.length; i++) {
    if (Array.isArray(children[i])) {
      return children.flat(Infinity);
    }
  }
  return children;
}
function isRemixNode(value) {
  if (value == null) return true;
  let type = typeof value;
  if (type === "string" || type === "number" || type === "bigint" || type === "boolean") {
    return true;
  }
  if (isRemixElement(value)) return true;
  if (!Array.isArray(value)) return false;
  for (let child of value) {
    if (!isRemixNode(child)) return false;
  }
  return true;
}

// ../../../src/runtime/to-vnode.ts
function flatMapChildrenToVNodes(props) {
  let children = props.children;
  if (children === void 0) return [];
  if (!Array.isArray(children)) return [toVNode(children)];
  let vnodes = [];
  flattenChildrenToVNodes(children, vnodes);
  return vnodes;
}
function flattenChildrenToVNodes(nodes, out) {
  let children = normalizeChildren(nodes);
  for (let i = 0; i < children.length; i++) {
    out.push(toVNode(children[i]));
  }
}
function toVNode(node) {
  if (isEmptyChild(node)) {
    return { kind: "empty", type: NON_RENDER_NODE };
  }
  if (isPrimitiveChild(node)) {
    return { kind: "text", type: TEXT_NODE, _text: String(node) };
  }
  if (isRemixElement(node)) {
    if (node.type === Fragment) {
      let props = parseHostProps(node.props);
      return {
        kind: "fragment",
        type: Fragment,
        key: node.key,
        _children: flatMapChildrenToVNodes(props)
      };
    }
    if (node.type === Frame) {
      invariant(isFrameProps(node.props), "<Frame /> requires a src prop");
      return { kind: "frame", type: Frame, key: node.key, props: node.props };
    }
    if (typeof node.type === "string") {
      let props = parseHostProps(node.props);
      let children = props.innerHTML != null ? [] : flatMapChildrenToVNodes(props);
      return {
        kind: "host",
        type: node.type,
        key: node.key,
        props,
        _children: children
      };
    }
    invariant(isElementFunction2(node.type), "Expected component element type");
    return { kind: "component", type: node.type, key: node.key, props: node.props };
  }
  if (Array.isArray(node)) {
    let children = [];
    flattenChildrenToVNodes(node, children);
    return { kind: "fragment", type: Fragment, _children: children };
  }
  invariant(false, "Unexpected RemixNode");
}
function isFrameProps(props) {
  return typeof props.src === "string" && props.src.length > 0;
}
function parseHostProps(props) {
  let children = props.children;
  invariant(children === void 0 || isRemixNode(children), "Invalid host children");
  let innerHTML = props.innerHTML;
  invariant(innerHTML === void 0 || typeof innerHTML === "string", "Invalid innerHTML prop");
  let mix = props.mix;
  invariant(mix === void 0 || isRuntimeMixValue(mix), "Invalid mix prop");
  return props;
}
function isRuntimeMixValue(value) {
  if (!Array.isArray(value)) return isMixinDescriptor(value);
  for (let descriptor of value) {
    if (!isMixinDescriptor(descriptor)) return false;
  }
  return true;
}
function isElementFunction2(value) {
  return typeof value === "function";
}

// ../../../src/runtime/mixins/on-mixin.ts
var onMixinType = (handle) => {
  let currentHandler = () => {
  };
  let currentType = "";
  let currentCapture = false;
  let currentNode = null;
  let reentry = null;
  let stableHandler = (event) => {
    reentry?.abort(new DOMException("", "EventReentry"));
    reentry = new AbortController();
    void currentHandler(event, reentry.signal);
  };
  handle.addEventListener("insert", (event) => {
    currentNode = event.node;
    currentNode.addEventListener(currentType, stableHandler, currentCapture);
  });
  handle.addEventListener("remove", () => {
    currentNode?.removeEventListener(currentType, stableHandler, currentCapture);
    currentNode = null;
    reentry?.abort(new DOMException("", "AbortError"));
  });
  return (type, handler, captureBoolean = false) => {
    let previousType = currentType;
    let previousCapture = currentCapture;
    let needsRebind = currentType !== type || currentCapture !== captureBoolean;
    currentType = type;
    currentHandler = handler;
    currentCapture = captureBoolean;
    if (needsRebind && currentNode) {
      currentNode.removeEventListener(previousType, stableHandler, previousCapture);
      currentNode.addEventListener(type, stableHandler, captureBoolean);
    }
    return handle.element;
  };
};
var onMixin = createMixin(onMixinType);
function isOnMixinDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") return false;
  let candidate = descriptor;
  return candidate.type === onMixinType && Array.isArray(candidate.args);
}
function on(type, handler, captureBoolean) {
  return onMixin(
    type,
    handler,
    captureBoolean
  );
}

// ../../../src/runtime/universal/events.ts
var NO_DESCRIPTORS = [];
function resolveDirectEventDescriptors(mix) {
  if (!mix) return NO_DESCRIPTORS;
  if (!Array.isArray(mix)) return isOnMixinDescriptor(mix) ? [mix] : null;
  for (let index = 0; index < mix.length; index++) {
    if (!isOnMixinDescriptor(mix[index])) return null;
  }
  return mix;
}
function syncDirectEventListeners(target, descriptors, state) {
  if (descriptors === void 0 || descriptors.length === 0) {
    teardownDirectEventListeners(target, state);
    return void 0;
  }
  let live = state ?? { bindings: [] };
  let bindings = live.bindings;
  for (let index = 0; index < descriptors.length; index++) {
    let args = descriptors[index].args;
    let type = args[0];
    let handler = args[1];
    let capture = args[2] ?? false;
    let binding = bindings[index];
    if (!binding) {
      binding = { type, handler, capture, reentry: null, stableHandler: null };
      bindings[index] = binding;
      attach(target, binding);
      continue;
    }
    if (binding.type !== type || binding.capture !== capture) {
      detach(target, binding);
      binding.type = type;
      binding.capture = capture;
      attach(target, binding);
    }
    binding.handler = handler;
  }
  for (let index = descriptors.length; index < bindings.length; index++) {
    detach(target, bindings[index]);
  }
  bindings.length = descriptors.length;
  return live;
}
function teardownDirectEventListeners(target, state) {
  if (!state) return;
  let bindings = state.bindings;
  for (let index = 0; index < bindings.length; index++) {
    detach(target, bindings[index]);
  }
  bindings.length = 0;
}
function abandonDirectEventListeners(state) {
  if (!state) return;
  let bindings = state.bindings;
  for (let index = 0; index < bindings.length; index++) {
    bindings[index].handler = void 0;
    abortReentry(bindings[index], "AbortError");
  }
  bindings.length = 0;
}
function attach(target, binding) {
  let stableHandler = binding.stableHandler;
  if (!stableHandler) {
    stableHandler = (event) => {
      let handler = binding.handler;
      if (!handler) return;
      abortReentry(binding, "EventReentry");
      let reentry = new AbortController();
      binding.reentry = reentry;
      void handler(event, reentry.signal);
    };
    binding.stableHandler = stableHandler;
  }
  target.addEventListener(binding.type, stableHandler, binding.capture);
}
function detach(target, binding) {
  if (binding.stableHandler) {
    target.removeEventListener(binding.type, binding.stableHandler, binding.capture);
  }
  abortReentry(binding, "AbortError");
}
function abortReentry(binding, reason) {
  binding.reentry?.abort(new DOMException("", reason));
  binding.reentry = null;
}

// ../../../src/runtime/universal/persistence.ts
var registry = /* @__PURE__ */ Symbol("remix.renderer.persistence");
function createRendererPersistence() {
  return { [registry]: { retained: /* @__PURE__ */ new Set(), token: 0 } };
}
function retainHostRemoval(persistence, target, parent) {
  let pending = prepareMixinRemoval(target._mixState);
  if (!pending) return null;
  let scope = persistence[registry];
  let token = ++scope.token;
  target._persistence = { parent, token };
  scope.retained.add(target);
  bindMixinRuntime(target._mixState, void 0);
  return { token, done: pending };
}
function settleRetainedRemoval(persistence, target, token) {
  if (target._persistence?.token !== token) return false;
  target._persistence = void 0;
  persistence[registry].retained.delete(target);
  return true;
}
function reclaimRetainedHost(persistence, target) {
  cancelPendingMixinRemoval(target._mixState);
  target._persistence = void 0;
  persistence[registry].retained.delete(target);
}
function findRetainedHost(persistence, type, key, parent) {
  if (key == null) return null;
  for (let target of persistence[registry].retained) {
    if (target._persistence?.parent !== parent) continue;
    if (target.type !== type) continue;
    if (target.key !== key) continue;
    return target;
  }
  return null;
}

// ../../../src/runtime/universal/reconcile.ts
var FRAMES_UNSUPPORTED = "Frames are not supported by this renderer host; <Frame /> requires the DOM runtime";
function mixinsUnsupported(type) {
  return `Mixins are not supported by this renderer host; remove mix from <${type} /> or implement host.getEventTarget`;
}
function rawHtmlUnsupported(type) {
  return `innerHTML is not supported by this renderer host; remove innerHTML from <${type} />`;
}
function createReconciler(host) {
  let noChildren = [];
  function mount(next, parent, vParent, context, anchor, cursor) {
    if (cursor) host.hydration?.normalize(cursor);
    switch (next.kind) {
      case "empty": {
        return { kind: "empty", type: next.type, key: next.key, _parent: vParent };
      }
      case "text": {
        let adopted = cursor ? host.hydration?.adoptText(next._text, parent, cursor) ?? null : null;
        let textNode = adopted;
        if (textNode === null) {
          textNode = host.createText(next._text, parent);
          host.insert(textNode, parent, anchor);
        }
        return {
          kind: "text",
          type: next.type,
          key: next.key,
          _text: next._text,
          _node: textNode,
          _parent: vParent
        };
      }
      case "fragment": {
        let mounted = {
          kind: "fragment",
          type: next.type,
          key: next.key,
          _children: noChildren,
          _parent: vParent
        };
        mounted._children = diffChildren(
          null,
          next._children,
          parent,
          mounted,
          context,
          anchor,
          cursor
        );
        return mounted;
      }
      case "host": {
        return mountHost(next, parent, vParent, context, anchor, cursor);
      }
      case "component": {
        return diffComponent(null, next, parent, vParent, context, anchor, cursor);
      }
      case "frame": {
        return mountFrame(next, parent, vParent, context, anchor, cursor);
      }
    }
  }
  function mountHost(next, parent, vParent, context, anchor, cursor) {
    let persistence = host.persistence;
    if (persistence) {
      let retained = findRetainedHost(
        persistence,
        next.type,
        next.key,
        parent
      );
      if (retained) {
        reclaimRetainedHost(persistence, retained);
        try {
          placeReclaimed(retained, parent, anchor);
          return diffHost(retained, next, parent, vParent, context, true);
        } catch (error) {
          detachHost(retained, context);
          throw error;
        }
      }
    }
    let resolved = resolveHostProps(next.type, next.props, vParent, context);
    let mounted;
    try {
      let adopted = cursor ? host.hydration?.adoptElement(next.type, resolved.props, parent, cursor) ?? null : null;
      let hostNode = adopted ? adopted.element : host.createElement(next.type, resolved.props, parent);
      let shared = host.isSharedElement?.(hostNode) === true;
      mounted = {
        kind: "host",
        type: next.type,
        key: next.key,
        props: next.props,
        _children: noChildren,
        _node: hostNode,
        _parent: vParent,
        _mixedProps: resolved.props,
        _mixState: resolved.state,
        _directEventDescriptors: resolved.directEvents,
        _shared: shared
      };
      let html = rawHtml(resolved.props);
      if (html === void 0) {
        mounted._children = diffChildren(
          null,
          next._children,
          hostNode,
          mounted,
          context,
          null,
          adopted?.children
        );
      } else {
        applyRawHtml(mounted, html);
      }
      syncHostEvents(mounted);
      host.finalizeElement?.(hostNode, resolved.props);
      if (!adopted && !shared) host.insert(hostNode, parent, anchor);
      bindHostMixins(mounted, parent, context);
      return mounted;
    } catch (error) {
      if (mounted) removeNode2(mounted, context);
      else teardownMixins(resolved.state);
      throw error;
    }
  }
  function mountFrame(next, parent, vParent, context, anchor, cursor) {
    let createFrame2 = host.createFrame;
    if (!createFrame2) throw new Error(FRAMES_UNSUPPORTED);
    return {
      kind: "frame",
      type: next.type,
      key: next.key,
      props: next.props,
      _frame: createFrame2(next.props, parent, anchor, context.frame, cursor),
      _parent: vParent
    };
  }
  function diff(curr, next, parent, vParent, context, anchor, cursor) {
    if (curr === null) return mount(next, parent, vParent, context, anchor, cursor);
    if (curr.kind !== next.kind || curr.type !== next.type) {
      return replace(curr, next, parent, vParent, context, anchor);
    }
    if (curr.kind === "component" && context.shouldRemountComponent?.(curr.type) === true) {
      return replace(curr, next, parent, vParent, context, anchor);
    }
    switch (next.kind) {
      case "empty": {
        return { kind: "empty", type: next.type, key: next.key, _parent: vParent };
      }
      case "text": {
        let text = curr;
        if (text._text !== next._text) host.setText(text._node, next._text);
        return {
          kind: "text",
          type: next.type,
          key: next.key,
          _text: next._text,
          _node: text._node,
          _parent: vParent
        };
      }
      case "fragment": {
        let currFragment = curr;
        let mounted = {
          kind: "fragment",
          type: next.type,
          key: next.key,
          _children: noChildren,
          _parent: vParent
        };
        let childAnchor = nextSiblingAnchor(currFragment) ?? anchor;
        mounted._children = diffChildren(
          currFragment._children,
          next._children,
          parent,
          mounted,
          context,
          childAnchor,
          cursor
        );
        return mounted;
      }
      case "host": {
        return diffHost(curr, next, parent, vParent, context);
      }
      case "frame": {
        let currFrame = curr;
        currFrame._frame.update(next.props);
        return {
          kind: "frame",
          type: next.type,
          key: next.key,
          props: next.props,
          _frame: currFrame._frame,
          _parent: vParent
        };
      }
      case "component": {
        return diffComponent(
          curr,
          next,
          parent,
          vParent,
          context,
          anchor,
          cursor
        );
      }
    }
  }
  function diffHost(currHost, next, parent, vParent, context, reclaimed = false) {
    let hostNode = currHost._node;
    let previous = currHost._mixedProps;
    let resolved = resolveHostProps(next.type, next.props, vParent, context, currHost._mixState);
    let mounted = {
      kind: "host",
      type: next.type,
      key: next.key,
      props: next.props,
      _children: noChildren,
      _node: hostNode,
      _parent: vParent,
      _mixedProps: resolved.props,
      _mixState: resolved.state,
      _directEventDescriptors: resolved.directEvents,
      _directEventState: currHost._directEventState,
      _shared: currHost._shared
    };
    let childrenCommitted = false;
    try {
      let inlineLifecycle = (resolved.state?.runners.length ?? 0) > 0 && !isInUpdateScope(hostNode, context);
      if (inlineLifecycle) dispatchMixinBeforeUpdate(resolved.state);
      let previousHtml = rawHtml(previous);
      let html = rawHtml(resolved.props);
      if (html !== void 0) {
        if (previousHtml === void 0) {
          let children = currHost._children;
          for (let index = 0; index < children.length; index++) {
            releaseNode(children[index], context);
          }
          applyRawHtml(mounted, html);
        } else if (previousHtml !== html) {
          applyRawHtml(mounted, html);
        }
      } else {
        if (previousHtml !== void 0) applyRawHtml(mounted, "");
        mounted._children = diffChildren(
          previousHtml === void 0 ? currHost._children : null,
          next._children,
          hostNode,
          mounted,
          context,
          null,
          void 0
        );
      }
      childrenCommitted = true;
      host.patchProps(hostNode, previous, resolved.props);
      syncHostEvents(mounted);
      host.finalizeElement?.(hostNode, resolved.props);
      bindHostMixins(mounted, parent, context, reclaimed ? { dispatchReclaimed: true } : void 0);
      if (inlineLifecycle) {
        context.scheduler.enqueueCommitPhase([() => dispatchMixinCommit(resolved.state)]);
      }
      return mounted;
    } catch (error) {
      if (childrenCommitted) {
        currHost._children = mounted._children;
        for (let child of mounted._children) child._parent = currHost;
      }
      currHost._mixState = mounted._mixState;
      currHost._directEventState = mounted._directEventState;
      throw error;
    }
  }
  function placeReclaimed(retained, parent, anchor) {
    if (retained._shared) return;
    let hostNode = retained._node;
    if (host.parentNode(hostNode) === parent && host.nextSibling(hostNode) === anchor) return;
    host.insert(hostNode, parent, anchor);
  }
  function replace(curr, next, parent, vParent, context, anchor) {
    let first = findFirstAnchor(curr);
    if (first !== null && host.parentNode(first) === parent) {
      let placeholder = host.createComment("rmx:replace", parent);
      host.insert(placeholder, parent, first);
      try {
        removeNode2(curr, context);
        return mount(next, parent, vParent, context, placeholder, void 0);
      } finally {
        host.remove(placeholder);
      }
    }
    let fallbackAnchor = nextSiblingAnchor(curr) ?? anchor;
    removeNode2(curr, context);
    return mount(next, parent, vParent, context, fallbackAnchor, void 0);
  }
  function diffChildren(curr, next, parent, vParent, context, anchor, cursor) {
    let keyed = hasKeyedChildren(next);
    if (curr === null) {
      if (keyed) warnDuplicateKeys(next);
      return mountChildren(next, parent, vParent, context, anchor, cursor);
    }
    let clearChildren = host.clearChildren;
    if (clearChildren && next.length === 0 && anchor === null && canClearChildren(vParent, curr)) {
      for (let index2 = 0; index2 < curr.length; index2++) releaseNode(curr[index2], context);
      clearChildren(parent);
      return noChildren;
    }
    if (keyed) return diffKeyedChildren(curr, next, parent, vParent, context, anchor, cursor);
    let committed = next;
    let index = 0;
    try {
      for (; index < next.length; index++) {
        committed[index] = diff(
          index < curr.length ? curr[index] : null,
          next[index],
          parent,
          vParent,
          context,
          anchor,
          cursor
        );
      }
    } catch (error) {
      adoptCommittedChildren(committed, index, curr, null, context);
      throw error;
    }
    for (let extra = next.length; extra < curr.length; extra++) {
      removeNode2(curr[extra], context);
    }
    return committed;
  }
  function adoptCommittedChildren(committed, count, curr, matches, context) {
    for (let index = 0; index < count; index++) {
      let child = committed[index];
      let oldIndex = matches === null ? index : matches[index];
      if (oldIndex < 0 || oldIndex >= curr.length) {
        removeNode2(child, context);
        continue;
      }
      child._parent = curr[oldIndex]._parent;
      curr[oldIndex] = child;
    }
  }
  function mountChildren(next, parent, vParent, context, anchor, cursor) {
    let committed = next;
    let index = 0;
    try {
      for (; index < next.length; index++) {
        committed[index] = mount(next[index], parent, vParent, context, anchor, cursor);
      }
    } catch (error) {
      for (let mountedIndex = 0; mountedIndex < index; mountedIndex++) {
        removeNode2(committed[mountedIndex], context);
      }
      throw error;
    }
    return committed;
  }
  function diffKeyedChildren(curr, next, parent, vParent, context, anchor, cursor) {
    let matches = matchKeyedChildren(curr, next);
    let analysis = analyzeKeyedChildMatches(curr.length, matches);
    if (analysis.hasRemovals) {
      let matched = new Uint8Array(curr.length);
      for (let index2 = 0; index2 < matches.length; index2++) {
        let oldIndex = matches[index2];
        if (oldIndex >= 0) matched[oldIndex] = 1;
      }
      for (let oldIndex = 0; oldIndex < curr.length; oldIndex++) {
        if (matched[oldIndex] === 0) removeNode2(curr[oldIndex], context);
      }
    }
    let committed = next;
    let index = 0;
    try {
      for (; index < next.length; index++) {
        let oldIndex = matches[index];
        committed[index] = diff(
          oldIndex >= 0 ? curr[oldIndex] : null,
          next[index],
          parent,
          vParent,
          context,
          anchor,
          cursor
        );
      }
    } catch (error) {
      adoptCommittedChildren(committed, index, curr, matches, context);
      throw error;
    }
    let children = committed;
    if (analysis.canSkipPlacement) return children;
    let stableIndexes = lisMatches(matches);
    let stableCursor = stableIndexes.length - 1;
    let placementAnchor = anchor;
    for (let position = next.length - 1; position >= 0; position--) {
      let child = children[position];
      if (stableIndexes[stableCursor] === position) {
        stableCursor--;
      } else {
        place(child, parent, placementAnchor);
      }
      placementAnchor = findFirstAnchor(child) ?? placementAnchor;
    }
    return children;
  }
  function canClearChildren(vParent, children) {
    if (vParent.kind !== "host" || vParent._shared) return false;
    return canClearNodes(children);
  }
  function canClearNodes(children) {
    for (let index = 0; index < children.length; index++) {
      if (!canClearNode(children[index])) return false;
    }
    return true;
  }
  function canClearNode(target) {
    switch (target.kind) {
      case "empty":
      case "text":
        return true;
      case "host":
        if (target._mixState || target._persistence || target._shared) return false;
        return canClearNodes(target._children);
      case "fragment":
        return canClearNodes(target._children);
      case "component":
        return target._content === null || canClearNode(target._content);
      case "frame":
        return false;
    }
  }
  function place(target, parent, anchor) {
    let first = findFirstAnchor(target);
    if (first === null || host.parentNode(first) !== parent) return;
    if (first === anchor) return;
    let last = findLastAnchor(target);
    if (last === null) return;
    if (anchor !== null && rangeContains(first, last, anchor)) return;
    let current = first;
    while (current !== null) {
      let following = current === last ? null : host.nextSibling(current);
      host.insert(current, parent, anchor);
      if (current === last) return;
      current = following;
    }
  }
  function rangeContains(first, last, target) {
    let current = first;
    while (current !== null) {
      if (current === target) return true;
      if (current === last) return false;
      current = host.nextSibling(current);
    }
    return false;
  }
  function diffComponent(curr, next, parent, vParent, context, anchor, cursor) {
    let handle = curr === null ? createHandle(next.type, vParent, context) : curr._handle;
    let mounted = {
      kind: "component",
      type: next.type,
      key: next.key,
      props: next.props,
      _handle: handle,
      _content: null,
      _superseded: false,
      _parent: vParent,
      _context: context
    };
    if (curr === null) return renderComponent(null, mounted, parent, context, anchor, cursor);
    curr._superseded = true;
    try {
      return renderComponent(curr._content, mounted, parent, context, anchor, cursor);
    } catch (error) {
      curr._superseded = false;
      mounted._superseded = true;
      handle.setScheduleUpdate(context.scheduler, curr, parent);
      throw error;
    }
  }
  function createHandle(type, vParent, context) {
    return createComponent({
      id: context.nextComponentId(vParent),
      type,
      frame: context.frame,
      getContext: (contextType) => findContextValue(vParent, contextType),
      getFrameByName: (name2) => context.getFrameByName(name2),
      getTopFrame: () => context.getTopFrame()
    });
  }
  function renderComponent(currContent, target, parent, context, anchor, cursor) {
    let handle = target._handle;
    if (handle.isRemoved()) {
      target._content = currContent;
      return target;
    }
    let mounting = currContent === null;
    try {
      let [element, tasks] = handle.render(target.props);
      context.scheduler.enqueueTasks(tasks);
      target._content = diff(currContent, toVNode(element), parent, target, context, anchor, cursor);
      handle.setScheduleUpdate(context.scheduler, target, parent);
    } catch (error) {
      if (mounting) {
        target._superseded = true;
        context.scheduler.enqueueTasks(handle.remove());
      } else {
        context.scheduler.enqueueTasks(handle.releasePendingTasks());
      }
      throw error;
    }
    return target;
  }
  function removeNode2(target, context) {
    switch (target.kind) {
      case "empty": {
        return;
      }
      case "text": {
        host.remove(target._node);
        return;
      }
      case "fragment": {
        let children = target._children;
        for (let index = 0; index < children.length; index++) {
          removeNode2(children[index], context);
        }
        return;
      }
      case "host": {
        removeHost(target, context);
        return;
      }
      case "frame": {
        target._frame.dispose();
        removeRange(target._frame.start, target._frame.end);
        return;
      }
      case "component": {
        if (target._content !== null) removeNode2(target._content, context);
        target._superseded = true;
        context.scheduler.enqueueTasks(target._handle.remove());
        return;
      }
    }
  }
  function removeHost(target, context) {
    let persistence = host.persistence;
    if (persistence) {
      if (target._persistence) return;
      let parent = host.parentNode(target._node);
      if (parent !== null) {
        let retained = retainHostRemoval(persistence, target, parent);
        if (retained) {
          void retained.done.catch(() => {
          }).finally(() => {
            if (target._persistence?.token !== retained.token) return;
            context.markDirty();
            context.scheduler.enqueueWork([
              () => {
                if (!settleRetainedRemoval(persistence, target, retained.token)) return;
                detachHost(target, context);
              }
            ]);
          });
          return;
        }
      }
    }
    detachHost(target, context);
  }
  function detachHost(target, context) {
    let children = target._children;
    if (target._shared) {
      for (let index = 0; index < children.length; index++) {
        removeNode2(children[index], context);
      }
      teardownMixins(target._mixState);
      let state = target._directEventState;
      if (state) {
        teardownDirectEventListeners(requireEventTarget(target), state);
        target._directEventState = void 0;
      }
      host.releaseElement?.(target._node, false);
      return;
    }
    teardownMixins(target._mixState);
    for (let index = 0; index < children.length; index++) {
      releaseNode(children[index], context);
    }
    abandonDirectEventListeners(target._directEventState);
    target._directEventState = void 0;
    host.releaseElement?.(target._node, true);
    host.remove(target._node);
  }
  function releaseNode(target, context) {
    switch (target.kind) {
      case "empty":
      case "text": {
        return;
      }
      case "fragment": {
        let children = target._children;
        for (let index = 0; index < children.length; index++) {
          releaseNode(children[index], context);
        }
        return;
      }
      case "host": {
        if (target._shared) {
          detachHost(target, context);
          return;
        }
        teardownMixins(target._mixState);
        let children = target._children;
        for (let index = 0; index < children.length; index++) {
          releaseNode(children[index], context);
        }
        abandonDirectEventListeners(target._directEventState);
        target._directEventState = void 0;
        host.releaseElement?.(target._node, true);
        return;
      }
      case "frame": {
        target._frame.dispose();
        return;
      }
      case "component": {
        if (target._content !== null) releaseNode(target._content, context);
        target._superseded = true;
        context.scheduler.enqueueTasks(target._handle.remove());
        return;
      }
    }
  }
  function removeRange(start, end) {
    let parent = host.parentNode(start);
    if (parent === null) return;
    let current = start;
    while (current !== null) {
      let following = current === end ? null : host.nextSibling(current);
      if (host.parentNode(current) === parent) host.remove(current);
      if (current === end) return;
      current = following;
    }
  }
  function rawHtml(props) {
    let html = props.innerHTML;
    return html == null ? void 0 : html;
  }
  function applyRawHtml(target, html) {
    let setInnerHTML = host.setInnerHTML;
    if (!setInnerHTML) throw new Error(rawHtmlUnsupported(target.type));
    setInnerHTML(target._node, html);
  }
  function resolveHostProps(type, props, vParent, context, state) {
    let directEvents = resolveDirectEventDescriptors(props.mix);
    if (directEvents) {
      if (state) teardownMixins(state);
      return { props, directEvents };
    }
    let resolved = resolveMixedProps({
      hostType: type,
      frame: context.frame,
      scheduler: context.scheduler,
      getContext: (contextType) => typeof contextType === "function" ? findContextValue(vParent, contextType) : void 0,
      props,
      state
    });
    return { props: resolved.props, state: resolved.state };
  }
  function requireEventTarget(target) {
    let getEventTarget = host.getEventTarget;
    if (!getEventTarget) throw new Error(mixinsUnsupported(target.type));
    return getEventTarget(target._node);
  }
  function syncHostEvents(target) {
    let descriptors = target._directEventDescriptors;
    let state = target._directEventState;
    if (state === void 0 && (descriptors === void 0 || descriptors.length === 0)) return;
    target._directEventState = syncDirectEventListeners(
      requireEventTarget(target),
      descriptors,
      state
    );
  }
  function bindHostMixins(target, parent, context, options) {
    let state = target._mixState;
    if (!state) return;
    let binding = {
      node: requireEventTarget(target),
      parent,
      key: target.key,
      target,
      frame: context.frame,
      scheduler: context.scheduler,
      enqueueUpdate(done) {
        enqueueHostMixinUpdate(state, context, done);
      },
      contains(container) {
        return containsNode(container, target._node);
      }
    };
    bindMixinRuntime(state, binding, options);
  }
  function enqueueHostMixinUpdate(state, context, done) {
    context.markDirty();
    context.scheduler.enqueueWork([
      () => {
        if (state.aborted || !state.binding) {
          done(getMixinRuntimeSignal(state));
          return;
        }
        let target = state.binding.target;
        let inlineLifecycle = !isInUpdateScope(target._node, context);
        try {
          if (inlineLifecycle) dispatchMixinBeforeUpdate(state);
          let previous = target._mixedProps;
          let resolved = resolveHostProps(target.type, target.props, target._parent, context, state);
          target._mixedProps = resolved.props;
          target._mixState = resolved.state;
          target._directEventDescriptors = resolved.directEvents;
          host.patchProps(target._node, previous, resolved.props);
          syncHostEvents(target);
          host.finalizeElement?.(target._node, resolved.props);
          if (inlineLifecycle) {
            context.scheduler.enqueueCommitPhase([() => dispatchMixinCommit(resolved.state)]);
          }
        } finally {
          done(getMixinRuntimeSignal(state));
        }
      }
    ]);
  }
  function containsNode(parent, target) {
    let current = target;
    while (current !== null) {
      if (current === parent) return true;
      current = host.parentNode(current);
    }
    return false;
  }
  function isInUpdateScope(target, context) {
    let parents = context.scheduler.updateParents();
    for (let index = 0; index < parents.length; index++) {
      if (containsNode(parents[index], target)) return true;
    }
    return false;
  }
  function rootTailAnchor(root2) {
    if (root2._anchor != null) return root2._anchor;
    let children = root2._children;
    for (let index = children.length - 1; index >= 0; index--) {
      let last = findLastAnchor(children[index], isAttached);
      if (last !== null) return host.nextSibling(last);
    }
    return null;
  }
  function nextSiblingAnchor(target) {
    return findNextSiblingAnchor(target, rootTailAnchor, isAttached);
  }
  function isAttached(target) {
    return host.parentNode(target) !== null;
  }
  return {
    renderRoot(curr, input, root2, context) {
      return diff(
        curr,
        toVNode(input),
        root2._node,
        root2,
        context,
        root2._anchor ?? null,
        context.hydration
      );
    },
    updateComponent(target, updateParent, context) {
      if (target._superseded) return;
      context.markDirty();
      renderComponent(
        target._content,
        target,
        updateParent,
        context,
        nextSiblingAnchor(target),
        void 0
      );
    },
    releaseComponent(target, context) {
      if (target._superseded) return;
      context.scheduler.enqueueTasks(target._handle.releasePendingTasks());
    },
    removeNode: removeNode2
  };
}

// ../../../src/runtime/universal/renderer.ts
var componentCount = 0;
function createRenderer(host) {
  let reconciler = createReconciler(host);
  return {
    createRoot(container, options = {}) {
      if (options.hydration && !host.hydration) {
        throw new Error("Hydration is not supported by this renderer host");
      }
      let events = new TypedEventTarget();
      let root2 = {
        kind: "root",
        type: ROOT_VNODE,
        _node: container,
        _children: [],
        _anchor: options.before,
        _componentId: options.componentId
      };
      let unmounted = false;
      let scheduler = options.scheduler ?? createRendererScheduler({
        reportError(error) {
          let event = Object.assign(new Event("error", { cancelable: true }), { error });
          if (!events.dispatchEvent(event)) return;
          setTimeout(() => {
            throw error;
          }, 0);
        }
      });
      let frame = options.frame ?? createUnsupportedFrame();
      let context = {
        frame,
        scheduler,
        reconciler,
        hydration: options.hydration,
        nextComponentId(parent) {
          if (parent.kind === "root" && parent._componentId !== void 0) {
            let id = parent._componentId;
            parent._componentId = void 0;
            return id;
          }
          return `c${++componentCount}`;
        },
        getFrameByName(name2) {
          return options.getFrameByName?.(name2);
        },
        getTopFrame() {
          return options.getTopFrame?.() ?? frame;
        },
        shouldRemountComponent: options.shouldRemountComponent,
        markDirty() {
          if (host.commit) scheduler.markDirty(commit);
        }
      };
      function commit() {
        host.commit?.(container);
      }
      return Object.assign(events, {
        render(input) {
          if (unmounted) throw new Error("Cannot render an unmounted root");
          scheduler.runSync(() => {
            context.markDirty();
            let current = root2._children.length > 0 ? root2._children[0] : null;
            let committed = reconciler.renderRoot(current, input, root2, context);
            root2._children[0] = committed;
            context.hydration = void 0;
          });
        },
        flush() {
          scheduler.flush();
        },
        unmount() {
          if (unmounted) return;
          unmounted = true;
          if (root2._children.length === 0) return;
          scheduler.runSync(() => {
            context.markDirty();
            let current = root2._children[0];
            root2._children.length = 0;
            reconciler.removeNode(current, context);
          });
        }
      });
    }
  };
}
function createUnsupportedFrame() {
  return createFrameHandle({
    replace() {
      throw new Error(FRAMES_UNSUPPORTED);
    },
    reload() {
      throw new Error(FRAMES_UNSUPPORTED);
    }
  });
}

// ../../../src/runtime/dom-renderer/controlled.ts
var states = /* @__PURE__ */ new WeakMap();
function createControlledReflection(scheduler) {
  function track(element) {
    let state = {
      element,
      disposed: false,
      listenersAttached: false,
      pendingRestoreVersion: 0,
      managesValue: false,
      managesChecked: false,
      hasControlledValue: false,
      controlledValue: void 0,
      hasControlledChecked: false,
      controlledChecked: void 0,
      onInput() {
        if (!shouldRestoreOnInput(state)) return;
        scheduleRestore(state);
      },
      onChange() {
        scheduleRestore(state);
      }
    };
    states.set(element, state);
    scheduler.enqueueTasks([
      () => {
        if (state.disposed) return;
        element.addEventListener("input", state.onInput);
        element.addEventListener("change", state.onChange);
        state.listenersAttached = true;
      }
    ]);
    return state;
  }
  return {
    finalize(element, props) {
      let state = states.get(element);
      if (state === void 0) {
        if (!isControlledProp(props, "value") && !isControlledProp(props, "checked")) return;
        state = track(element);
      }
      state.managesValue = canManageValue(element);
      state.managesChecked = canReflectProperty(element, "checked");
      state.hasControlledValue = state.managesValue && isControlledProp(props, "value");
      state.controlledValue = props.value;
      state.hasControlledChecked = state.managesChecked && isControlledProp(props, "checked");
      state.controlledChecked = props.checked;
      state.pendingRestoreVersion++;
      restore(state);
    },
    release(element, discarded) {
      let state = states.get(element);
      if (state === void 0) return;
      states.delete(element);
      state.disposed = true;
      state.pendingRestoreVersion++;
      if (discarded) {
        state.listenersAttached = false;
        return;
      }
      if (state.listenersAttached) {
        element.removeEventListener("input", state.onInput);
        element.removeEventListener("change", state.onChange);
        state.listenersAttached = false;
      }
    }
  };
}
function shouldRestoreOnInput(state) {
  if (state.hasControlledChecked) return false;
  if (state.element.localName === "select") return false;
  return true;
}
function scheduleRestore(state) {
  if (state.disposed) return;
  let version = ++state.pendingRestoreVersion;
  queueMicrotask(() => {
    if (state.disposed) return;
    if (state.pendingRestoreVersion !== version) return;
    restore(state);
  });
}
function restore(state) {
  let element = state.element;
  if (state.hasControlledValue && readProperty(element, "value") !== state.controlledValue) {
    writeProperty(element, "value", state.controlledValue);
  }
  if (state.hasControlledChecked && readProperty(element, "checked") !== state.controlledChecked) {
    writeProperty(element, "checked", state.controlledChecked);
  }
}
function isControlledProp(props, name2) {
  return name2 in props && props[name2] !== void 0;
}
function canManageValue(element) {
  if (element.localName === "progress") return false;
  return canReflectProperty(element, "value");
}
function canReflectProperty(element, key) {
  return key in element && !key.includes("-");
}
function readProperty(element, key) {
  if (!canReflectProperty(element, key)) return void 0;
  return element[key];
}
function writeProperty(element, key, value) {
  if (!canReflectProperty(element, key)) return;
  element[key] = value == null ? "" : value;
}

// ../../../src/runtime/spa-response.ts
var spaResponses;
function getSpaResponseData(response) {
  return spaResponses?.get(response);
}

// ../../../src/runtime/frame-resolution.ts
async function unwrapFrameResolution(resolution) {
  if (!(resolution instanceof Response)) return { content: resolution };
  let data = getSpaResponseData(resolution);
  if (data) {
    return {
      content: data.node,
      redirectedTo: data.redirectedTo
    };
  }
  let content = resolution.body ?? await resolution.text();
  return {
    content,
    redirectedTo: resolution.redirected && resolution.url ? resolution.url : void 0
  };
}

// ../../../src/runtime/dom-renderer/frames.ts
var FRAME_RUNTIME_REQUIRED = "Cannot render <Frame /> without frame runtime. Use run() or pass frameInit to createRoot/createRangeRoot.";
function createDomFrame(props, parent, before, frame, styles, cursor) {
  let runtime = getFrameRuntime(frame);
  if (!runtime || runtime.canResolveFrames === false) {
    throw new Error(FRAME_RUNTIME_REQUIRED);
  }
  let currentProps = props;
  let range = adoptFrameRange(currentProps, runtime, cursor) ?? mountFrameRange(currentProps, parent, before, frame, runtime, styles);
  return {
    get start() {
      return range.start;
    },
    get end() {
      return range.end;
    },
    update(nextProps) {
      let previousProps = currentProps;
      currentProps = nextProps;
      let previousSrc = previousProps.src;
      let nextSrc = nextProps.src;
      let previousName = getFrameName(previousProps);
      let nextName = getFrameName(nextProps);
      if (previousName !== nextName || previousSrc !== nextSrc && !range.resolved) {
        let currentParent = range.start.parentNode ?? parent;
        let replaceBefore = range.end.nextSibling;
        disposeFrameRange(range);
        removeFrameRange(range, currentParent);
        range = mountFrameRange(currentProps, currentParent, replaceBefore, frame, runtime, styles);
        return;
      }
      let serverFrameReload = runtime.serverFrameReload;
      if (previousSrc !== nextSrc) {
        range.instance.handle.src = nextSrc;
        resolveClientFrame(range, currentProps, runtime, serverFrameReload);
      } else if (serverFrameReload) {
        resolveClientFrame(range, currentProps, runtime, serverFrameReload);
      }
      if (!range.resolved && range.fallbackRoot) {
        range.fallbackRoot.render(currentProps.fallback ?? null);
      }
    },
    dispose() {
      disposeFrameRange(range);
    }
  };
}
function isFrameStartComment(node) {
  return isCommentNode(node) && node.data.trim().startsWith("rmx:f:");
}
function adoptFrameRange(props, runtime, cursor) {
  if (!cursor || cursor.current === cursor.end) return void 0;
  let start = cursor.current;
  if (!isFrameStartComment(start)) return void 0;
  let end = findFrameEndComment(start, cursor.end);
  if (!end) return void 0;
  let instance = runtime.frameInstances.get(start);
  if (!instance) {
    instance = createFrameInstance(props, [start, end], runtime);
    runtime.frameInstances.set(start, instance);
  }
  cursor.current = end.nextSibling;
  return {
    start,
    end,
    instance,
    fallbackRoot: void 0,
    resolveToken: 0,
    resolveController: void 0,
    resolved: true
  };
}
function mountFrameRange(props, parent, before, frame, runtime, styles) {
  let doc = parent.ownerDocument ?? document;
  let start = doc.createComment(` rmx:f:f${crypto.randomUUID().slice(0, 8)} `);
  let end = doc.createComment(" /rmx:f ");
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);
  let fallbackRoot = createRangeRoot([start, end], { frame, styleManager: styles });
  fallbackRoot.render(props.fallback ?? null);
  let instance = createFrameInstance(props, [start, end], runtime);
  runtime.frameInstances.set(start, instance);
  let range = {
    start,
    end,
    instance,
    fallbackRoot,
    resolveToken: 0,
    resolveController: void 0,
    resolved: false
  };
  resolveClientFrame(range, props, runtime, runtime.serverFrameReload);
  return range;
}
function createFrameInstance(props, boundaries, runtime) {
  return createFrame(boundaries, {
    name: getFrameName(props),
    src: props.src,
    errorTarget: runtime.errorTarget,
    loadModule: runtime.loadModule,
    resolveFrame: runtime.resolveFrame,
    pendingClientEntries: runtime.pendingClientEntries,
    scheduler: runtime.scheduler,
    styleManager: runtime.styleManager,
    data: {},
    moduleCache: runtime.moduleCache,
    moduleLoads: runtime.moduleLoads,
    frameInstances: runtime.frameInstances,
    namedFrames: runtime.namedFrames
  });
}
function resolveClientFrame(range, props, runtime, serverFrameReload) {
  let instance = range.instance;
  let token = range.resolveToken + 1;
  range.resolveToken = token;
  range.resolveController?.abort();
  let reload = serverFrameReload ? instance.beginClientFrameReloadForAncestorReload(serverFrameReload.signal) : void 0;
  if (!reload) {
    instance.cancelReload();
  }
  let resolveController = reload?.controller ?? new AbortController();
  range.resolveController = resolveController;
  let frameCommitted = Promise.withResolvers();
  let resolve = Promise.resolve().then(
    () => runtime.resolveFrame(props.src, {
      signal: resolveController.signal,
      target: getFrameName(props)
    })
  ).then(async (resolution) => {
    if (range.resolveToken !== token || resolveController.signal.aborted) return;
    let { content } = await unwrapFrameResolution(resolution);
    if (range.resolveToken !== token || resolveController.signal.aborted) return;
    range.fallbackRoot?.dispose();
    range.fallbackRoot = void 0;
    let nextContent = asAbortableFrameContent(content, resolveController.signal);
    await instance.render(nextContent, {
      signal: resolveController.signal,
      reconciliationTracker: serverFrameReload?.reconciliationTracker,
      blockingFrameTracker: serverFrameReload?.blockingFrameTracker,
      onCommit: frameCommitted.resolve
    });
    if (range.resolveToken !== token || resolveController.signal.aborted) return;
    range.resolved = true;
  }).catch((error) => {
    if (reload && range.resolveToken === token && !resolveController.signal.aborted) {
      runtime.errorTarget.dispatchEvent(createComponentErrorEvent(error));
    }
  }).finally(() => {
    frameCommitted.resolve();
    reload?.complete();
    if (range.resolveController === resolveController) {
      range.resolveController = void 0;
    }
  });
  if (serverFrameReload?.reconciliationTracker && !props.fallback) {
    serverFrameReload.reconciliationTracker.waitFor(resolve);
  }
  if (serverFrameReload?.blockingFrameTracker && !props.fallback) {
    serverFrameReload.blockingFrameTracker.waitFor(frameCommitted.promise);
  }
}
function disposeFrameRange(range) {
  range.resolveToken++;
  range.resolveController?.abort();
  range.resolveController = void 0;
  range.fallbackRoot?.dispose();
  range.fallbackRoot = void 0;
  range.instance.dispose();
}
function removeFrameRange(range, parent) {
  let cursor = range.start;
  while (cursor) {
    let nextSibling = cursor.nextSibling;
    if (cursor.parentNode === parent) {
      parent.removeChild(cursor);
    }
    if (cursor === range.end) break;
    cursor = nextSibling;
  }
}
function asAbortableFrameContent(content, signal) {
  if (!(content instanceof ReadableStream)) return content;
  return createAbortableReadableStream(content, signal);
}
function createAbortableReadableStream(source, signal) {
  let reader = source.getReader();
  let aborted = false;
  let onAbort = () => {
    aborted = true;
    void reader.cancel(signal.reason);
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  return new ReadableStream({
    async pull(controller) {
      if (aborted) {
        controller.close();
        return;
      }
      let removeAbortReadListener;
      let abortRead = new Promise((resolve) => {
        if (signal.aborted) {
          resolve({ done: true, value: void 0 });
          return;
        }
        let onAbortRead = () => {
          resolve({ done: true, value: void 0 });
        };
        removeAbortReadListener = () => signal.removeEventListener("abort", onAbortRead);
        signal.addEventListener("abort", onAbortRead, { once: true });
      });
      let result = await Promise.race([reader.read(), abortRead]);
      removeAbortReadListener?.();
      if (result.done) {
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      signal.removeEventListener("abort", onAbort);
      return reader.cancel(reason);
    }
  });
}
function getFrameRuntime(frame) {
  let runtime = frame.$runtime;
  return isFrameRuntime(runtime) ? runtime : void 0;
}
function getFrameName(props) {
  let name2 = props.name;
  return typeof name2 === "string" && name2.length > 0 ? name2 : void 0;
}
function findFrameEndComment(start, before) {
  let depth = 1;
  let node = start.nextSibling;
  while (node && node !== before) {
    if (isFrameStartComment(node)) depth++;
    else if (isFrameEndComment(node)) {
      depth--;
      if (depth === 0) return node;
    }
    node = node.nextSibling;
  }
  return null;
}
function isFrameEndComment(node) {
  return isCommentNode(node) && node.data.trim() === "/rmx:f";
}
function isCommentNode(node) {
  return node?.nodeType === Node.COMMENT_NODE;
}

// ../../../src/runtime/client-entries.ts
function logHydrationMismatch(...msg) {
  console.error("Hydration mismatch:", ...msg);
}

// ../../../src/runtime/dom-renderer/nodes.ts
var SVG_NS2 = "http://www.w3.org/2000/svg";
var NO_PROPS = {};
function getOwnerDocument(parent) {
  if (parent instanceof Document) return parent;
  return parent.ownerDocument ?? document;
}
function isSvgParent(parent) {
  return parent instanceof Element && parent.namespaceURI === SVG_NS2 && parent.localName !== "foreignObject";
}
function createHostElement(type, parent) {
  let doc = getOwnerDocument(parent);
  if (type === "svg" || isSvgParent(parent)) return doc.createElementNS(SVG_NS2, type);
  return doc.createElement(type);
}
function isHeadType(type) {
  if (type === "head") return true;
  if (type.length !== 4) return false;
  return type.toLowerCase() === "head";
}
function getDocumentHead(parent) {
  if (parent instanceof Document) return parent.head;
  if (parent instanceof Node) return parent.ownerDocument?.head ?? null;
  return null;
}

// ../../../src/runtime/dom-renderer/hydration.ts
var domHydration = {
  normalize(cursor) {
    let current = cursor.current;
    if (current == null) return;
    cursor.current = skipAdoptableComments(current, cursor.end);
  },
  adoptText(text, _parent, cursor) {
    let current = cursor.current === cursor.end ? null : cursor.current;
    if (!(current instanceof Text)) return null;
    if (current.data !== text) {
      if (current.data.startsWith(text) && text.length < current.data.length) {
        let remainder = current.splitText(text.length);
        cursor.current = remainder;
        return current;
      }
      logHydrationMismatch("text mismatch", current.data, text);
      current.data = text;
    }
    cursor.current = current.nextSibling;
    return current;
  },
  adoptElement(type, props, parent, cursor) {
    let current = cursor.current === cursor.end ? null : cursor.current;
    if (isHeadType(type)) {
      let head = getDocumentHead(parent);
      if (head !== null) return adoptHead(head, props, current, cursor);
    }
    if (!(current instanceof Element)) return null;
    let svg = type === "svg" || isSvgParent(parent);
    let currentTag = svg ? current.tagName : current.tagName.toLowerCase();
    if (currentTag === type) return adopt(current, props, cursor);
    let candidate = skipAdoptableComments(current.nextSibling, cursor.end);
    if (candidate instanceof Element) {
      let candidateTag = svg ? candidate.tagName : candidate.tagName.toLowerCase();
      if (candidateTag === type) return adopt(candidate, props, cursor);
    }
    logHydrationMismatch("tag", currentTag, type);
    cursor.current = void 0;
    return null;
  }
};
function adopt(element, props, cursor) {
  cursor.current = element.nextSibling;
  patchHostProps(NO_PROPS, props, element);
  return { element, children: { current: element.firstChild } };
}
function adoptHead(head, props, current, cursor) {
  let children = cursor;
  if (current instanceof Element && current.tagName.toLowerCase() === "head") {
    children = { current: current.firstChild };
    cursor.current = current.nextSibling;
    if (current !== head) {
      while (current.firstChild !== null) {
        head.appendChild(current.firstChild);
      }
      current.remove();
    }
  }
  patchHostProps(NO_PROPS, props, head);
  return { element: head, children };
}
function skipAdoptableComments(current, end) {
  let node = current;
  while (node !== null && node !== end) {
    if (node.nodeType !== Node.COMMENT_NODE || isFrameStartComment(node)) return node;
    node = node.nextSibling;
  }
  return null;
}

// ../../../src/runtime/dom-renderer/host.ts
var domPersistence = createRendererPersistence();
function createDomHost(scheduler, styles) {
  let controlled = createControlledReflection(scheduler);
  return {
    createElement(type, props, parent) {
      let head = isHeadType(type) ? getDocumentHead(parent) : null;
      let element = head ?? createHostElement(type, parent);
      patchHostProps(NO_PROPS, props, element);
      return element;
    },
    createText(text, parent) {
      return getOwnerDocument(parent).createTextNode(text);
    },
    createComment(text, parent) {
      return getOwnerDocument(parent).createComment(text);
    },
    setText(node, text) {
      node.nodeValue = text;
    },
    patchProps(element, previous, next) {
      patchHostProps(previous, next, element);
    },
    insert(node, parent, before) {
      if (before === null) parent.appendChild(node);
      else parent.insertBefore(node, before);
    },
    remove(node) {
      node.parentNode?.removeChild(node);
    },
    parentNode(node) {
      return node.parentNode;
    },
    nextSibling(node) {
      return node.nextSibling;
    },
    getEventTarget(element) {
      return element;
    },
    isSharedElement(element) {
      return element === element.ownerDocument.head;
    },
    setInnerHTML(element, html) {
      element.innerHTML = html;
    },
    clearChildren(parent) {
      parent.textContent = "";
    },
    finalizeElement(element, props) {
      controlled.finalize(element, props);
    },
    releaseElement(element, discarded) {
      controlled.release(element, discarded);
    },
    persistence: domPersistence,
    hydration: domHydration,
    createFrame(props, parent, before, frame, cursor) {
      return createDomFrame(props, parent, before, frame, styles, cursor);
    }
  };
}

// ../../../src/runtime/refresh.ts
var componentStalenessCheck = null;
var roots = /* @__PURE__ */ new Set();
function registerRoot(root2) {
  roots.add(root2);
}
function unregisterRoot(root2) {
  roots.delete(root2);
}

// ../../../src/runtime/document-state.ts
function createDocumentState(_doc) {
  let doc = _doc ?? document;
  function getActiveElement() {
    return doc.activeElement || doc.body;
  }
  function hasSelectionCapabilities(elem) {
    let nodeName = elem.nodeName.toLowerCase();
    return nodeName === "input" && "type" in elem && (elem.type === "text" || elem.type === "search" || elem.type === "tel" || elem.type === "url" || elem.type === "password") || nodeName === "textarea" || elem instanceof HTMLElement && elem.contentEditable === "true";
  }
  function getSelection(input) {
    if ("selectionStart" in input && typeof input.selectionStart === "number" && "selectionEnd" in input) {
      let htmlInput = input;
      return {
        start: htmlInput.selectionStart ?? 0,
        end: htmlInput.selectionEnd ?? htmlInput.selectionStart ?? 0
      };
    }
    return null;
  }
  function setSelection(input, offsets) {
    if ("selectionStart" in input && "selectionEnd" in input) {
      try {
        let htmlInput = input;
        htmlInput.selectionStart = offsets.start;
        htmlInput.selectionEnd = Math.min(offsets.end, htmlInput.value?.length ?? 0);
      } catch {
      }
    }
  }
  function isInDocument(node) {
    return doc.documentElement.contains(node);
  }
  function getSelectionInformation() {
    let focusedElem = getActiveElement();
    return {
      focusedElem,
      selectionRange: focusedElem && hasSelectionCapabilities(focusedElem) ? getSelection(focusedElem) : null
    };
  }
  function restoreSelection(priorSelectionInformation) {
    let curFocusedElem = getActiveElement();
    let priorFocusedElem = priorSelectionInformation.focusedElem;
    let priorSelectionRange = priorSelectionInformation.selectionRange;
    if (curFocusedElem !== priorFocusedElem && priorFocusedElem && isInDocument(priorFocusedElem)) {
      let ancestors = [];
      let ancestor = priorFocusedElem;
      while (ancestor) {
        if (ancestor.nodeType === Node.ELEMENT_NODE) {
          let el2 = ancestor;
          ancestors.push({
            element: el2,
            left: el2.scrollLeft ?? 0,
            top: el2.scrollTop ?? 0
          });
        }
        ancestor = ancestor.parentNode;
      }
      if (priorSelectionRange !== null && hasSelectionCapabilities(priorFocusedElem)) {
        setSelection(priorFocusedElem, priorSelectionRange);
      }
      if (priorFocusedElem instanceof HTMLElement && typeof priorFocusedElem.focus === "function") {
        priorFocusedElem.focus();
      }
      for (let info of ancestors) {
        info.element.scrollLeft = info.left;
        info.element.scrollTop = info.top;
      }
    }
  }
  let selectionInfo = null;
  function capture() {
    selectionInfo = getSelectionInformation();
  }
  function restore2() {
    if (selectionInfo !== null) {
      restoreSelection(selectionInfo);
    }
    selectionInfo = null;
  }
  return { capture, restore: restore2 };
}

// ../../../src/runtime/scheduler.ts
function createScheduler(doc, rootTarget) {
  let documentState = createDocumentState(doc);
  return createRendererScheduler({
    beforeUpdate: documentState.capture,
    beforeCommit: documentState.restore,
    reportWarning(message) {
      console.warn(`${message} Consider reducing hydration regions.`);
    },
    reportError(error) {
      console.error(error);
      rootTarget.dispatchEvent(createComponentErrorEvent(error));
    }
  });
}

// ../../../src/runtime/vdom.ts
function getHydrationComponentIdFromRangeStart(start) {
  if (!(start instanceof Comment)) return void 0;
  let marker = start.data.trim();
  if (!marker.startsWith("rmx:h:")) return void 0;
  let id = marker.slice("rmx:h:".length);
  return id.length > 0 ? id : void 0;
}
function createRangeRoot(boundaries, options = {}) {
  let [start, end] = boundaries;
  let container = end.parentNode;
  invariant(container, "Expected parent node");
  invariant(start.parentNode === container, "Boundaries must share parent");
  let hydrationStart = start.nextSibling;
  let hasServerContent = hydrationStart !== null && hydrationStart !== end;
  return createVirtualRoot({
    container,
    before: end,
    styles: options.styleManager ?? defaultStyleManager,
    hydration: hasServerContent ? { current: hydrationStart, end } : void 0,
    componentId: getHydrationComponentIdFromRangeStart(start),
    options
  });
}
function createRoot(container, options = {}) {
  let styles = options.styleManager ?? defaultStyleManager;
  let hasServerContent = container.innerHTML.trim() !== "";
  if (hasServerContent) {
    styles.adoptServerStyles(container);
  }
  return createVirtualRoot({
    container,
    before: null,
    styles,
    hydration: hasServerContent ? { current: container.firstChild } : void 0,
    componentId: void 0,
    options
  });
}
function createVirtualRoot(target) {
  let { container, before, styles, options } = target;
  let currentElement;
  let hydration = target.hydration;
  let eventTarget = new TypedEventTarget();
  let scheduler = options.scheduler ?? createScheduler(container.ownerDocument ?? document, eventTarget);
  let frameHandle = options.frame ?? createRootFrameHandle({
    src: options.frameInit?.src,
    resolveFrame: options.frameInit?.resolveFrame,
    loadModule: options.frameInit?.loadModule,
    errorTarget: eventTarget,
    scheduler,
    styleManager: styles
  });
  let renderer = createRenderer(createDomHost(scheduler, styles));
  function createCoreRoot() {
    return renderer.createRoot(container, {
      scheduler,
      frame: frameHandle,
      before,
      hydration,
      componentId: target.componentId,
      getFrameByName(name2) {
        let runtime = frameHandle.$runtime;
        return isFrameRuntime(runtime) ? runtime.namedFrames.get(name2) : void 0;
      },
      getTopFrame() {
        let runtime = frameHandle.$runtime;
        return isFrameRuntime(runtime) ? runtime.topFrame : void 0;
      },
      shouldRemountComponent(type) {
        return componentStalenessCheck !== null && componentStalenessCheck(type) === true;
      }
    });
  }
  let core = createCoreRoot();
  let disposed = false;
  let isErrorForwardingAttached = false;
  function forwardDomError(event) {
    eventTarget.dispatchEvent(createComponentErrorEvent(getComponentError(event)));
  }
  function attachDomErrorForwarding() {
    if (isErrorForwardingAttached) return;
    container.addEventListener("error", forwardDomError);
    isErrorForwardingAttached = true;
  }
  function detachDomErrorForwarding() {
    if (!isErrorForwardingAttached) return;
    container.removeEventListener("error", forwardDomError);
    isErrorForwardingAttached = false;
  }
  attachDomErrorForwarding();
  let root2 = Object.assign(eventTarget, {
    render(element) {
      attachDomErrorForwarding();
      currentElement = element;
      if (disposed) {
        core = createCoreRoot();
        disposed = false;
      }
      hydration = void 0;
      let mounted = core;
      scheduler.enqueueWork([() => mounted.render(element)]);
      scheduler.flush();
    },
    reconcile() {
      if (currentElement === void 0) return;
      root2.render(currentElement);
    },
    dispose() {
      detachDomErrorForwarding();
      unregisterRoot(root2);
      currentElement = void 0;
      if (disposed) return;
      disposed = true;
      let mounted = core;
      scheduler.enqueueWork([() => mounted.unmount()]);
      scheduler.flush();
    },
    flush() {
      scheduler.flush();
    }
  });
  registerRoot(root2);
  return root2;
}
function createRootFrameHandle(init) {
  let resolveFrame = init.resolveFrame ?? (() => {
    throw new Error(
      "Cannot render <Frame /> without frame runtime. Use run() or pass frameInit to createRoot/createRangeRoot."
    );
  });
  let runtime = createFrameRuntime({
    topFrame: void 0,
    loadModule: init.loadModule ?? (() => {
      throw new Error("loadModule is required to hydrate client entries inside <Frame />");
    }),
    resolveFrame,
    errorTarget: init.errorTarget,
    pendingClientEntries: /* @__PURE__ */ new Map(),
    scheduler: init.scheduler,
    styleManager: init.styleManager,
    moduleCache: /* @__PURE__ */ new Map(),
    moduleLoads: /* @__PURE__ */ new Map(),
    frameInstances: /* @__PURE__ */ new WeakMap(),
    namedFrames: /* @__PURE__ */ new Map()
  });
  runtime.canResolveFrames = !!init.resolveFrame;
  let frame = createFrameHandle({ src: init.src ?? "/", $runtime: runtime });
  runtime.topFrame = frame;
  return frame;
}

// ../../../src/runtime/client-entry-boundary.ts
var CLIENT_ENTRY_BOUNDARY_OWNER = /* @__PURE__ */ Symbol("ClientEntryBoundaryOwner");
function getClientEntryBoundaryOwner(marker) {
  return marker[CLIENT_ENTRY_BOUNDARY_OWNER];
}
function setClientEntryBoundaryOwner(marker, identity, root2) {
  let owner = { identity, root: root2 };
  Object.defineProperties(marker, {
    [CLIENT_ENTRY_BOUNDARY_OWNER]: {
      configurable: true,
      value: owner
    },
    $rmx: {
      configurable: true,
      value: root2
    }
  });
  return owner;
}
function disposeClientEntryBoundary(marker) {
  let boundaryMarker = marker;
  let owner = boundaryMarker[CLIENT_ENTRY_BOUNDARY_OWNER];
  if (!owner) return false;
  delete boundaryMarker[CLIENT_ENTRY_BOUNDARY_OWNER];
  delete boundaryMarker.$rmx;
  owner.root.dispose();
  return true;
}

// ../../../src/runtime/diff-dom.ts
var REMIX_PRESERVE_DOM_ATTRIBUTE = "data-rmx-preserve-dom";
function diffNodes(curr, next, context) {
  let parent = curr[0]?.parentNode ?? context.regionParent ?? null;
  invariant(parent, "Parent node not found");
  let regionTailRef = context.regionTailRef ?? (curr.length > 0 ? curr[curr.length - 1].nextSibling : null);
  diffSiblingUnits(curr, next, parent, regionTailRef, context);
}
function diffNode(current, next, context) {
  if (isTextNode(current) && isTextNode(next)) {
    let newText = next.textContent || "";
    if (current.textContent !== newText) current.textContent = newText;
    return;
  }
  if (isVirtualRootStartMarker(current) && isVirtualRootStartMarker(next)) {
    let nextData = next.data;
    if (current.data !== nextData) {
      current.data = nextData;
    }
    let end = findHydrationEndMarker(next);
    return end;
  }
  if (isCommentNode2(current) && isCommentNode2(next) && markerKindsMatch(current, next)) {
    let newData = next.data;
    let updated = false;
    if (isFrameStartMarker(current)) {
      if (shouldPreserveFrameStartMarker(current, next, context)) {
        if (current.data !== newData) {
          current.data = newData;
        }
        updated = true;
        let frame = context.frameInstances.get(current);
        let nextMarkerData = getFrameMarkerData(next, context);
        if (frame && nextMarkerData) {
          if (nextMarkerData.status === "resolved") {
            let nextEnd = findFrameEndMarker(next);
            let nextContent = collectFrameContentFragment(current.ownerDocument, next, nextEnd);
            let render = frame.renderMarkerContent(
              { ...nextMarkerData, id: getFrameId(next) },
              nextContent,
              {
                data: context.data,
                signal: context.signal,
                reconciliationTracker: context.reconciliationTracker
              }
            );
            if (context.reconciliationTracker) context.reconciliationTracker.waitFor(render);
            else void render;
            return nextEnd;
          }
          if (frame.isDisplayingResolvedContent()) {
            return findFrameEndMarker(next);
          }
        }
      } else if (current.data !== newData) {
        disposeFrameStartMarker(current, context);
        current.data = newData;
        updated = true;
      }
    }
    if (!updated && current.data !== newData) {
      current.data = newData;
    }
    return;
  }
  if (isElement(current) && isElement(next)) {
    if (current.tagName !== next.tagName) {
      let parent2 = current.parentNode;
      if (parent2) {
        parent2.insertBefore(next, current);
        removeNode(current, parent2, context);
      }
      return;
    }
    if (shouldPreserveDomElement(current, next)) return;
    diffElementAttributes(current, next);
    if (shouldPreserveElementChildren(current, next)) return;
    diffElementChildren(current, next, context);
    return;
  }
  let parent = current.parentNode;
  if (parent) {
    parent.insertBefore(next, current);
    removeNode(current, parent, context);
  }
}
function diffElementAttributes(current, next) {
  let prevAttrNames = current.getAttributeNames();
  let nextAttrNames = next.getAttributeNames();
  let nextNameSet = new Set(nextAttrNames);
  for (let name2 of prevAttrNames) {
    if (!nextNameSet.has(name2)) {
      if (shouldPreserveLiveAttribute(current, next, name2)) continue;
      current.removeAttribute(name2);
    }
  }
  for (let name2 of nextAttrNames) {
    let prevVal = current.getAttribute(name2);
    let nextVal = next.getAttribute(name2);
    if (prevVal !== nextVal) {
      if (shouldPreserveLiveAttribute(current, next, name2)) continue;
      current.setAttribute(name2, nextVal == null ? "" : String(nextVal));
    }
  }
}
function shouldPreserveDomElement(current, next) {
  if (!next.hasAttribute(REMIX_PRESERVE_DOM_ATTRIBUTE)) return false;
  if (!current.hasAttribute(REMIX_PRESERVE_DOM_ATTRIBUTE)) {
    current.setAttribute(REMIX_PRESERVE_DOM_ATTRIBUTE, "");
  }
  return true;
}
function shouldPreserveLiveAttribute(current, next, name2) {
  if (name2 === "open") {
    if (current instanceof HTMLDetailsElement && next instanceof HTMLDetailsElement) {
      return current.open !== next.open;
    }
    if (current instanceof HTMLDialogElement && next instanceof HTMLDialogElement) {
      return current.open !== next.open;
    }
  }
  if (name2 === "checked") {
    if (current instanceof HTMLInputElement && next instanceof HTMLInputElement) {
      return current.checked !== next.checked;
    }
  }
  if (name2 === "value") {
    if (current instanceof HTMLInputElement && next instanceof HTMLInputElement && shouldPreserveInputValue(current)) {
      return current.value !== next.value;
    }
  }
  if (name2 === "selected") {
    if (current instanceof HTMLOptionElement && next instanceof HTMLOptionElement) {
      return current.selected !== next.selected;
    }
  }
  if (name2 === "popover") {
    return isPopoverOpen(current) !== isPopoverOpen(next);
  }
  return false;
}
function shouldPreserveElementChildren(current, next) {
  if (current instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
    return current.value !== next.value;
  }
  return false;
}
function shouldPreserveInputValue(input) {
  return input.type !== "button" && input.type !== "checkbox" && input.type !== "hidden" && input.type !== "image" && input.type !== "radio" && input.type !== "reset" && input.type !== "submit";
}
function isPopoverOpen(element) {
  try {
    return element.matches(":popover-open");
  } catch {
    return false;
  }
}
function diffElementChildren(current, next, context) {
  let currentChildren;
  if (context.isActiveModulePreload && current === current.ownerDocument.head) {
    currentChildren = [];
    for (let node of current.childNodes) {
      if (!context.isActiveModulePreload(node)) currentChildren.push(node);
    }
  } else {
    currentChildren = Array.from(current.childNodes);
  }
  let nextChildren = Array.from(next.childNodes);
  diffSiblingUnits(currentChildren, nextChildren, current, null, context);
}
function diffSiblingUnits(currentNodes, nextNodes, parent, regionTailRef, context) {
  let currentUnits = parseSiblingUnits(currentNodes);
  let nextUnits = parseSiblingUnits(nextNodes);
  let keyToIndex = /* @__PURE__ */ new Map();
  for (let i = 0; i < currentUnits.length; i++) {
    let key = getSiblingUnitKey(currentUnits[i]);
    if (key !== void 0) keyToIndex.set(key, i);
  }
  let used = new Array(currentUnits.length).fill(false);
  let matchIndexForNext = new Array(nextUnits.length).fill(-1);
  for (let i = 0; i < nextUnits.length; i++) {
    let nextUnit = nextUnits[i];
    let matchIndex = -1;
    let key = getSiblingUnitKey(nextUnit);
    if (key !== void 0) {
      let keyedIndex = keyToIndex.get(key);
      if (keyedIndex !== void 0 && !used[keyedIndex] && siblingUnitsComparable(currentUnits[keyedIndex], nextUnit)) {
        matchIndex = keyedIndex;
      }
    }
    if (matchIndex === -1 && nextUnit.kind !== "node") {
      for (let j = 0; j < currentUnits.length; j++) {
        let currentUnit = currentUnits[j];
        if (used[j] || currentUnit.kind !== nextUnit.kind) continue;
        if (shouldPreserveBoundaryUnit(currentUnit, nextUnit, context)) {
          matchIndex = j;
          break;
        }
      }
    }
    if (matchIndex !== -1) used[matchIndex] = true;
    matchIndexForNext[i] = matchIndex;
  }
  let remainingCurrentIndexes = [];
  for (let i = 0; i < currentUnits.length; i++) {
    if (!used[i]) remainingCurrentIndexes.push(i);
  }
  let remainingNextIndexes = [];
  for (let i = 0; i < nextUnits.length; i++) {
    if (matchIndexForNext[i] === -1) remainingNextIndexes.push(i);
  }
  let remainingLength = Math.min(remainingCurrentIndexes.length, remainingNextIndexes.length);
  for (let i = 0; i < remainingLength; i++) {
    let currentIndex = remainingCurrentIndexes[i];
    let nextIndex = remainingNextIndexes[i];
    let currentUnit = currentUnits[currentIndex];
    let nextUnit = nextUnits[nextIndex];
    if (currentUnit.kind !== "node" || nextUnit.kind !== "node" || getSiblingUnitKey(currentUnit) !== void 0 || getSiblingUnitKey(nextUnit) !== void 0 || !siblingUnitsComparable(currentUnit, nextUnit)) {
      continue;
    }
    used[currentIndex] = true;
    matchIndexForNext[nextIndex] = currentIndex;
  }
  let committed = new Array(nextUnits.length);
  for (let i = 0; i < nextUnits.length; i++) {
    let matchIndex = matchIndexForNext[i];
    let nextUnit = nextUnits[i];
    if (matchIndex === -1) {
      committed[i] = nextUnit;
      continue;
    }
    let currentUnit = currentUnits[matchIndex];
    if (currentUnit.kind === "node" && nextUnit.kind === "node") {
      diffNode(currentUnit.node, nextUnit.node, context);
      committed[i] = currentUnit;
      continue;
    }
    invariant(currentUnit.kind !== "node" && nextUnit.kind !== "node", "Expected boundaries");
    let replacement = getCommentMarkerRangeReplacement(
      currentUnit.start,
      nextUnit.start,
      currentNodes,
      nextNodes,
      currentUnit.startIndex,
      nextUnit.startIndex,
      context
    );
    if (replacement) {
      replaceCommentMarkerRange(replacement, parent, context);
      committed[i] = nextUnit;
      continue;
    }
    let cursor = diffNode(currentUnit.start, nextUnit.start, context);
    if (!cursor && currentUnit.kind === "frame" && nextUnit.kind === "frame") {
      diffNodes(
        collectNodesBetween(currentUnit.start, currentUnit.end),
        nextNodes.slice(nextUnit.startIndex + 1, nextUnit.endIndex),
        {
          ...context,
          regionParent: parent,
          regionTailRef: currentUnit.end
        }
      );
    }
    committed[i] = currentUnit;
  }
  let anchor = regionTailRef;
  for (let i = committed.length - 1; i >= 0; i--) {
    let unit = committed[i];
    let first = getSiblingUnitFirstNode(unit);
    let ref = anchor?.parentNode === parent ? anchor : null;
    if (unit.kind === "node" && isPreservedDomElement(unit.node) && unit.node.parentNode === parent) {
      anchor = unit.node;
      continue;
    }
    placeSiblingUnitBefore(unit, parent, ref);
    if (first.parentNode === parent) anchor = first;
  }
  for (let i = 0; i < currentUnits.length; i++) {
    if (!used[i]) removeSiblingUnit(currentUnits[i], parent, context);
  }
}
function parseSiblingUnits(nodes) {
  let units = [];
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (isVirtualRootStartMarker(node)) {
      let endIndex = findHydrationEndIndex(nodes, i);
      invariant(endIndex > i, "Hydration end marker not found");
      let end = nodes[endIndex];
      invariant(isVirtualRootEndMarker(end), "Expected hydration end marker");
      units.push({ kind: "hydration", start: node, end, startIndex: i, endIndex });
      i = endIndex;
      continue;
    }
    if (isFrameStartMarker(node)) {
      let endIndex = findFrameEndIndex(nodes, i);
      invariant(endIndex > i, "Frame end marker not found");
      let end = nodes[endIndex];
      invariant(isFrameEndMarker(end), "Expected frame end marker");
      units.push({ kind: "frame", start: node, end, startIndex: i, endIndex });
      i = endIndex;
      continue;
    }
    invariant(!isVirtualRootEndMarker(node), "Unexpected hydration end marker");
    invariant(!isFrameEndMarker(node), "Unexpected frame end marker");
    units.push({ kind: "node", node, startIndex: i, endIndex: i });
  }
  return units;
}
function getSiblingUnitKey(unit) {
  if (unit.kind !== "node" || !isElement(unit.node)) return;
  return unit.node.getAttribute("data-rmx-key") ?? void 0;
}
function siblingUnitsComparable(current, next) {
  if (current.kind !== next.kind) return false;
  if (current.kind !== "node" || next.kind !== "node") return true;
  return nodeTypesComparable(current.node, next.node);
}
function shouldPreserveBoundaryUnit(current, next, context) {
  if (current.kind !== next.kind) return false;
  return current.kind === "frame" ? shouldPreserveFrameStartMarker(current.start, next.start, context) : shouldPreserveHydrationStartMarker(current.start, next.start, context);
}
function getSiblingUnitFirstNode(unit) {
  return unit.kind === "node" ? unit.node : unit.start;
}
function placeSiblingUnitBefore(unit, parent, ref) {
  if (unit.kind === "node") {
    if (unit.node.parentNode !== parent || unit.node.nextSibling !== ref) {
      parent.insertBefore(unit.node, ref);
    }
    return;
  }
  let nodes = collectNodeRange(unit.start, unit.end);
  if (unit.start.parentNode === parent && unit.end.nextSibling === ref) return;
  let fragment = unit.start.ownerDocument.createDocumentFragment();
  for (let node of nodes) fragment.appendChild(node);
  parent.insertBefore(fragment, ref);
}
function removeSiblingUnit(unit, parent, context) {
  if (unit.kind === "node") {
    removeNode(unit.node, parent, context);
    return;
  }
  for (let node of collectNodeRange(unit.start, unit.end)) {
    removeNode(node, parent, context);
  }
}
function collectNodesBetween(start, end) {
  let nodes = [];
  let node = start.nextSibling;
  while (node && node !== end) {
    nodes.push(node);
    node = node.nextSibling;
  }
  return nodes;
}
function isPreservedDomElement(node) {
  return isElement(node) && node.hasAttribute(REMIX_PRESERVE_DOM_ATTRIBUTE);
}
function nodeTypesComparable(a, b) {
  if (isTextNode(a) && isTextNode(b)) return true;
  if (isElement(a) && isElement(b)) return a.tagName === b.tagName;
  if (isCommentNode2(a) && isCommentNode2(b)) return markerKindsMatch(a, b);
  return false;
}
function getMarkerKind(node) {
  if (!isCommentNode2(node)) return void 0;
  if (isFrameStartMarker(node)) return "frame-start";
  if (isFrameEndMarker(node)) return "frame-end";
  if (isVirtualRootStartMarker(node)) return "virtual-root-start";
  if (isVirtualRootEndMarker(node)) return "virtual-root-end";
  return void 0;
}
function markerKindsMatch(a, b) {
  return getMarkerKind(a) === getMarkerKind(b);
}
function isHydrationEndComment(node) {
  return isCommentNode2(node) && node.data.trim() === "/rmx:h";
}
function findHydrationEndMarker(start) {
  let node = start.nextSibling;
  let depth = 1;
  while (node) {
    if (isCommentNode2(node)) {
      if (isVirtualRootStartMarker(node)) depth++;
      if (isVirtualRootEndMarker(node)) {
        depth--;
        if (depth === 0) return node;
      }
    }
    node = node.nextSibling;
  }
  throw new Error("Hydration end marker not found");
}
function findHydrationEndIndex(nodes, startIdx) {
  let depth = 1;
  for (let j = startIdx + 1; j < nodes.length; j++) {
    let node = nodes[j];
    if (isVirtualRootStartMarker(node)) depth++;
    if (isHydrationEndComment(node)) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return startIdx;
}
function findFrameEndMarker(start) {
  let node = start.nextSibling;
  let depth = 1;
  while (node) {
    if (isFrameStartMarker(node)) depth++;
    if (isFrameEndMarker(node)) {
      depth--;
      if (depth === 0) return node;
    }
    node = node.nextSibling;
  }
  throw new Error("Frame end marker not found");
}
function findFrameEndIndex(nodes, startIdx) {
  let depth = 1;
  for (let j = startIdx + 1; j < nodes.length; j++) {
    let node = nodes[j];
    if (isFrameStartMarker(node)) depth++;
    if (isFrameEndMarker(node)) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return startIdx;
}
function isTextNode(node) {
  return node.nodeType === Node.TEXT_NODE;
}
function isElement(node) {
  return node.nodeType === Node.ELEMENT_NODE;
}
function isCommentNode2(node) {
  return node.nodeType === Node.COMMENT_NODE;
}
function isFrameStartMarker(node) {
  return node instanceof Comment && node.data.trim().startsWith("rmx:f:");
}
function isFrameEndMarker(node) {
  return node instanceof Comment && node.data.trim() === "/rmx:f";
}
function shouldPreserveFrameStartMarker(current, next, context) {
  if (!isFrameStartMarker(next)) return false;
  let nextData = getFrameMarkerData(next, context);
  let currentFrame = context.frameInstances.get(current);
  return currentFrame !== void 0 && nextData !== void 0 && currentFrame.matchesIdentity(nextData.src, nextData.name);
}
function shouldPreserveHydrationStartMarker(current, next, context) {
  if (!isVirtualRootStartMarker(next)) return false;
  let currentOwner = getClientEntryBoundaryOwner(current);
  let nextData = getHydrationMarkerData(next, context);
  return currentOwner !== void 0 && nextData !== void 0 && currentOwner.identity.moduleUrl === nextData.moduleUrl && currentOwner.identity.exportName === nextData.exportName;
}
function getCommentMarkerRangeReplacement(current, next, currentNodes, nextNodes, currentIndex, nextIndex, context) {
  if (isFrameStartMarker(current) && isFrameStartMarker(next) && !shouldPreserveFrameStartMarker(current, next, context)) {
    return {
      currentStart: current,
      nextStart: next,
      currentEndIndex: findFrameEndIndex(currentNodes, currentIndex),
      nextEndIndex: findFrameEndIndex(nextNodes, nextIndex)
    };
  }
  if (isVirtualRootStartMarker(current) && isVirtualRootStartMarker(next) && !shouldPreserveHydrationStartMarker(current, next, context)) {
    return {
      currentStart: current,
      nextStart: next,
      currentEndIndex: findHydrationEndIndex(currentNodes, currentIndex),
      nextEndIndex: findHydrationEndIndex(nextNodes, nextIndex)
    };
  }
}
function getHydrationMarkerData(marker, context) {
  let id = getHydrationId(marker);
  return context.data.h?.[id];
}
function getHydrationId(marker) {
  let trimmed = marker.data.trim();
  invariant(trimmed.startsWith("rmx:h:"), "Invalid hydration start marker");
  return trimmed.slice("rmx:h:".length);
}
function getFrameMarkerData(marker, context) {
  let id = getFrameId(marker);
  return context.data.f?.[id];
}
function getFrameId(marker) {
  let trimmed = marker.data.trim();
  invariant(trimmed.startsWith("rmx:f:"), "Invalid frame start marker");
  return trimmed.slice("rmx:f:".length);
}
function replaceCommentMarkerRange(replacement, parent, context) {
  let currentEnd = findCommentMarkerRangeEnd(replacement.currentStart);
  let nextEnd = findCommentMarkerRangeEnd(replacement.nextStart);
  let nextNodes = collectNodeRange(replacement.nextStart, nextEnd);
  let currentNodes = collectNodeRange(replacement.currentStart, currentEnd);
  for (let node of nextNodes) {
    parent.insertBefore(node, replacement.currentStart);
  }
  for (let node of currentNodes) {
    removeNode(node, parent, context);
  }
}
function findCommentMarkerRangeEnd(start) {
  if (isFrameStartMarker(start)) return findFrameEndMarker(start);
  if (isVirtualRootStartMarker(start)) return findHydrationEndMarker(start);
  throw new Error("Comment marker range start not found");
}
function collectNodeRange(start, end) {
  let nodes = [];
  let node = start;
  while (node) {
    nodes.push(node);
    if (node === end) break;
    node = node.nextSibling;
  }
  return nodes;
}
function collectFrameContentFragment(doc, start, end) {
  let fragment = doc.createDocumentFragment();
  let node = start.nextSibling;
  while (node && node !== end) {
    let next = node.nextSibling;
    fragment.appendChild(node);
    node = next;
  }
  return fragment;
}
function removeNode(node, parent, context) {
  disposeRemovedVirtualRoots(node);
  disposeRemovedSubFrames(node, context);
  if (node.parentNode === parent) {
    parent.removeChild(node);
  }
}
function disposeRemovedVirtualRoots(node) {
  let stack = [node];
  while (stack.length > 0) {
    let next = stack.pop();
    if (!next) continue;
    if (isVirtualRootStartMarker(next) && disposeClientEntryBoundary(next)) {
      continue;
    }
    for (let child of Array.from(next.childNodes)) {
      stack.push(child);
    }
  }
}
function disposeRemovedSubFrames(node, context) {
  let stack = [node];
  while (stack.length > 0) {
    let next = stack.pop();
    if (!next) continue;
    if (isFrameStartMarker(next)) {
      disposeFrameStartMarker(next, context);
    }
    for (let child of Array.from(next.childNodes)) {
      stack.push(child);
    }
  }
}
function disposeFrameStartMarker(marker, context) {
  let subFrame = context.frameInstances.get(marker);
  if (subFrame) {
    subFrame.dispose();
    context.frameInstances.delete(marker);
  }
}
function isVirtualRootStartMarker(node) {
  return isCommentNode2(node) && node.data.trim().startsWith("rmx:h:");
}
function isVirtualRootEndMarker(node) {
  return isCommentNode2(node) && node.data.trim() === "/rmx:h";
}

// ../../../src/runtime/stream-protocol.ts
var FLUSH_MARKER_PATTERN = /<!--\s*rmx:flush\s+(document|fragment)\s*-->/g;
function findFlushMarker(html, startIndex) {
  FLUSH_MARKER_PATTERN.lastIndex = startIndex;
  let match = FLUSH_MARKER_PATTERN.exec(html);
  if (!match) return void 0;
  return {
    index: match.index,
    endIndex: FLUSH_MARKER_PATTERN.lastIndex,
    kind: match[1]
  };
}

// ../../../src/runtime/module-preloader.ts
var SERVER_MODULE_PRELOAD_SELECTOR = 'link[data-rmx-module-preload][rel~="modulepreload" i][href]';
var modulePreloaders = /* @__PURE__ */ new WeakMap();
function getDocumentModulePreloader(doc) {
  let preloader = modulePreloaders.get(doc);
  if (!preloader) {
    preloader = createModulePreloader(doc);
    modulePreloaders.set(doc, preloader);
  }
  return preloader;
}
function createModulePreloader(doc) {
  let requestedUrls = /* @__PURE__ */ new Set();
  let activeLinks = /* @__PURE__ */ new WeakSet();
  let activeLinkCount = 0;
  function activateLink(link) {
    activeLinks.add(link);
    activeLinkCount++;
  }
  function deactivateLink(link) {
    if (activeLinks.delete(link)) activeLinkCount--;
  }
  function preload(href) {
    let link = doc.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    link.setAttribute("data-rmx-module-preload", "");
    let url = link.href;
    if (requestedUrls.has(url)) return;
    requestedUrls.add(url);
    activateLink(link);
    link.addEventListener(
      "load",
      () => {
        deactivateLink(link);
        link.remove();
      },
      { once: true }
    );
    link.addEventListener(
      "error",
      () => {
        deactivateLink(link);
        link.remove();
        requestedUrls.delete(url);
      },
      { once: true }
    );
    doc.head.append(link);
  }
  return {
    adoptInitialPreloadLinks(source) {
      for (let initialLink of source.querySelectorAll(
        SERVER_MODULE_PRELOAD_SELECTOR
      )) {
        let settle2 = function(succeeded) {
          if (settled) return;
          settled = true;
          deactivateLink(initialLink);
          deactivateLink(observerLink);
          initialLink.remove();
          observerLink.remove();
          if (!succeeded) requestedUrls.delete(url);
        };
        var settle = settle2;
        if (activeLinks.has(initialLink)) continue;
        let observerLink = doc.createElement("link");
        observerLink.rel = "modulepreload";
        observerLink.href = initialLink.href;
        observerLink.setAttribute("data-rmx-module-preload", "");
        let url = initialLink.href;
        requestedUrls.add(url);
        activateLink(initialLink);
        activateLink(observerLink);
        let settled = false;
        observerLink.addEventListener("load", () => settle2(true), { once: true });
        observerLink.addEventListener("error", () => settle2(false), { once: true });
        doc.head.append(observerLink);
      }
    },
    consumePreloadLinks(source) {
      let hrefs = [];
      for (let link of source.querySelectorAll(SERVER_MODULE_PRELOAD_SELECTOR)) {
        let href = link.getAttribute("href");
        link.remove();
        if (href) hrefs.push(href);
      }
      for (let href of hrefs) preload(href);
    },
    hasActivePreloads() {
      return activeLinkCount > 0;
    },
    isActivePreload(node) {
      return node instanceof HTMLLinkElement && activeLinks.has(node);
    }
  };
}

// ../../../src/runtime/frame.ts
var bufferedFrameTemplates = /* @__PURE__ */ new Map();
var frameTemplateListeners = /* @__PURE__ */ new Map();
var DOCTYPE_PATTERN = /<!doctype(?:\s[^>]*)?>/gi;
function createLinkedAbortController(first, second) {
  let controller = new AbortController();
  let signals = second ? [first, second] : [first];
  let abort = () => controller.abort();
  for (let signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return {
    controller,
    disconnect() {
      for (let signal of signals) {
        signal.removeEventListener("abort", abort);
      }
    }
  };
}
function stripDoctypeMarkup(html) {
  return html.replace(DOCTYPE_PATTERN, "");
}
function syncElementAttributes(target, source) {
  for (let attribute of Array.from(target.attributes)) {
    if (!source.hasAttribute(attribute.name)) {
      target.removeAttribute(attribute.name);
    }
  }
  for (let attribute of Array.from(source.attributes)) {
    if (target.getAttribute(attribute.name) !== attribute.value) {
      target.setAttribute(attribute.name, attribute.value);
    }
  }
}
var FRAME_RUNTIME = /* @__PURE__ */ Symbol("FrameRuntime");
function isFrameRuntime(value) {
  return isRecord(value) && Reflect.get(value, FRAME_RUNTIME) === true;
}
function createFrame(root2, init) {
  let container = createContainer(root2);
  let contentRoot;
  let reloadController;
  let ownsStyleManager = !init.styleManager;
  let reloadAbortUnsubscribe;
  let reloadKind;
  let styleManager = init.styleManager ?? createStyleManager();
  let modulePreloader = getDocumentModulePreloader(container.doc);
  let currentMarker = init.marker;
  let displayedContentStatus = init.marker?.status ?? "resolved";
  let pendingTemplateMarkerId;
  let pendingTemplateObserver;
  let pendingTemplateUnsubscribe;
  let inheritedReloadPending = false;
  let inheritedReloadAbortUnsubscribe;
  let disposed = false;
  let lifecycleController = new AbortController();
  if (isDocumentNode(container.root)) {
    modulePreloader.adoptInitialPreloadLinks(container.root);
  } else {
    modulePreloader.consumePreloadLinks(container.root);
  }
  mergeRmxDataFromDocument(init.data, container.doc);
  let runtime = createFrameRuntime({
    ...init,
    styleManager,
    reloadForNavigation: startReloadTransition
  });
  let frame = createFrameHandle({
    src: init.src,
    $runtime: runtime,
    reload: async () => (await reload()).signal,
    replace: async (content) => {
      await render(content);
    }
  });
  runtime.topFrame = runtime.topFrame ?? init.topFrame ?? frame;
  let frameName = init.marker?.name ?? init.name;
  if (frameName) {
    init.namedFrames.set(frameName, frame);
  }
  let context = {
    topFrame: runtime.topFrame,
    errorTarget: init.errorTarget,
    loadModule: init.loadModule,
    resolveFrame: init.resolveFrame,
    pendingClientEntries: init.pendingClientEntries,
    scheduler: init.scheduler,
    frame,
    styleManager,
    data: init.data,
    moduleCache: init.moduleCache,
    moduleLoads: init.moduleLoads,
    frameInstances: init.frameInstances,
    namedFrames: init.namedFrames,
    lifecycleSignal: lifecycleController.signal,
    regionTailRef: container.regionTailRef,
    regionParent: container.regionParent
  };
  async function render(content, options) {
    if (disposed || lifecycleController.signal.aborted || options?.signal?.aborted) return;
    let ownsData = options?.data === void 0;
    let renderOptions = {
      ...options,
      data: options?.data ?? {}
    };
    try {
      await renderContent(content, renderOptions);
    } finally {
      if (ownsData) clearRmxData(renderOptions.data);
    }
  }
  async function renderContent(content, options) {
    if (isRenderAborted(options.signal)) return;
    if (content instanceof ReadableStream) {
      let linkedAbort = createLinkedAbortController(lifecycleController.signal, options.signal);
      try {
        await renderFrameStream(
          content,
          container.doc,
          async (html, flushKind) => {
            if (isRenderAborted(options.signal)) return;
            await render(html, { ...options, flushKind });
          },
          linkedAbort.controller.signal
        );
      } finally {
        linkedAbort.disconnect();
      }
      return;
    }
    if (isRemixNodeFrameContent(content)) {
      if (!contentRoot) {
        let currentNodes = getContentNodes();
        removeVirtualRoots(currentNodes);
        disposeSubFrames(currentNodes, context);
        clearFrameContent();
        contentRoot = createFrameContentRoot();
      }
      if (isRenderAborted(options.signal)) return;
      let previousServerFrameReload = runtime.serverFrameReload;
      if (options.signal) {
        runtime.serverFrameReload = {
          signal: options.signal,
          reconciliationTracker: options.reconciliationTracker,
          blockingFrameTracker: options.blockingFrameTracker
        };
      }
      try {
        contentRoot.render(content);
        await new Promise((resolve) => context.scheduler.enqueueCommitPhase([resolve]));
        options.onCommit?.();
      } finally {
        runtime.serverFrameReload = previousServerFrameReload;
      }
      if (isRenderAborted(options.signal)) return;
      displayedContentStatus = options.contentStatus ?? "resolved";
      return;
    }
    if (contentRoot) {
      contentRoot.dispose();
      contentRoot = void 0;
    }
    if (typeof content === "string") {
      let flushed = await consumeFlushBatches(content, async (html, flushKind) => {
        await render(html, { ...options, flushKind });
      });
      if (flushed.applied) {
        if (flushed.remainder !== "") {
          await render(flushed.remainder, { ...options, flushKind: "fragment" });
        }
        return;
      }
    }
    let htmlContent = typeof content === "string" ? stripDoctypeMarkup(content) : void 0;
    let isFullDocumentReload = container.root instanceof Document && htmlContent !== void 0 && options.flushKind === "document";
    if (isFullDocumentReload && htmlContent !== void 0) {
      let parsed = new DOMParser().parseFromString(htmlContent, "text/html");
      modulePreloader.consumePreloadLinks(parsed);
      let responseData2 = options.data;
      mergeRmxDataFromDocument(responseData2, parsed);
      let responseContext2 = {
        ...context,
        data: responseData2,
        reconciliationTracker: options.reconciliationTracker,
        blockingFrameTracker: options.blockingFrameTracker
      };
      context.styleManager.adoptServerStyles(
        collectFrameServerStyleTags(createElementContainer(parsed))
      );
      syncElementAttributes(container.doc.documentElement, parsed.documentElement);
      diffNodes([container.doc.head], [parsed.head], {
        ...responseContext2,
        regionParent: container.doc.documentElement,
        regionTailRef: null,
        signal: options.signal,
        isActiveModulePreload: modulePreloader.hasActivePreloads() ? modulePreloader.isActivePreload : void 0
      });
      diffNodes([container.doc.body], [parsed.body], {
        ...responseContext2,
        regionParent: container.doc.documentElement,
        regionTailRef: null,
        signal: options.signal
      });
      let bodyContainer = createElementContainer(container.doc.body);
      if (isRenderAborted(options.signal)) return;
      scheduleHydrationInContainer(
        bodyContainer,
        responseContext2,
        options.reconciliationTracker,
        options.signal
      );
      let subFramesReady2 = createSubFrames(bodyContainer.childNodes, responseContext2, options);
      options.onCommit?.();
      await subFramesReady2;
      if (isRenderAborted(options.signal)) return;
      displayedContentStatus = options.contentStatus ?? "resolved";
      return;
    }
    let fragment = htmlContent !== void 0 ? createFragmentFromString(container.doc, htmlContent) : content;
    modulePreloader.consumePreloadLinks(fragment);
    context.styleManager.adoptServerStyles(
      collectFrameServerStyleTags(createElementContainer(fragment))
    );
    removeEmptyHeads(fragment);
    let responseData = options.data;
    mergeRmxDataFromFragment(responseData, fragment);
    let responseContext = {
      ...context,
      data: responseData,
      reconciliationTracker: options.reconciliationTracker,
      blockingFrameTracker: options.blockingFrameTracker
    };
    let nextContainer = createContainer(fragment);
    if (isRenderAborted(options.signal)) return;
    diffNodes(container.childNodes, Array.from(nextContainer.childNodes), {
      ...responseContext,
      regionTailRef: container.regionTailRef,
      regionParent: container.regionParent,
      signal: options.signal
    });
    scheduleHydrationInContainer(
      container,
      responseContext,
      options.reconciliationTracker,
      options.signal
    );
    let subFramesReady = createSubFrames(container.childNodes, responseContext, options);
    options.onCommit?.();
    await subFramesReady;
    if (isRenderAborted(options.signal)) return;
    displayedContentStatus = options.contentStatus ?? "resolved";
  }
  function isRenderAborted(signal) {
    return disposed || lifecycleController.signal.aborted || signal?.aborted === true;
  }
  function createFrameContentRoot() {
    let virtualRoot;
    if (container.root instanceof Document) {
      virtualRoot = createRoot(container.doc.body, {
        scheduler: context.scheduler,
        frame,
        styleManager: context.styleManager
      });
    } else {
      invariant(Array.isArray(root2), "Expected comment-bounded frame root");
      virtualRoot = createRangeRoot(root2, {
        scheduler: context.scheduler,
        frame,
        styleManager: context.styleManager
      });
    }
    virtualRoot.addEventListener("error", (event) => {
      if (context.errorTarget === virtualRoot) return;
      context.errorTarget.dispatchEvent(createComponentErrorEvent(getComponentError(event)));
    });
    return virtualRoot;
  }
  function getContentNodes() {
    return container.root instanceof Document ? Array.from(container.doc.body.childNodes) : container.childNodes;
  }
  function clearFrameContent() {
    for (let node of getContentNodes()) {
      node.parentNode?.removeChild(node);
    }
  }
  async function hydrateInitial() {
    let reconciliationTracker = createReconciliationTracker();
    context.styleManager.adoptServerStyles(collectFrameServerStyleTags(container));
    let subFramesReady = createSubFrames(container.childNodes, context);
    scheduleHydrationInContainer(container, context, reconciliationTracker);
    try {
      await subFramesReady;
      if (disposed || context.lifecycleSignal.aborted) return;
      if (currentMarker?.status === "pending") {
        await watchPendingFrameTemplate(currentMarker, reconciliationTracker);
      }
      reconciliationTracker.finalize();
      await reconciliationTracker.ready();
    } finally {
      clearRmxData(context.data);
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycleController.abort();
    clearRmxData(context.data);
    reloadController?.abort();
    reloadController = void 0;
    reloadAbortUnsubscribe?.();
    reloadAbortUnsubscribe = void 0;
    reloadKind = void 0;
    contentRoot?.dispose();
    contentRoot = void 0;
    clearPendingFrameTemplateWatch();
    removeVirtualRoots(container.childNodes);
    disposeSubFrames(container.childNodes, context);
    if (ownsStyleManager) {
      context.styleManager.dispose();
    }
    if (frameName) {
      if (init.namedFrames.get(frameName) === frame) {
        init.namedFrames.delete(frameName);
      }
    }
  }
  let readyPromise = hydrateInitial();
  return {
    render,
    ready: () => readyPromise,
    flush: () => context.scheduler.flush(),
    clearPendingTemplateWatch: clearPendingFrameTemplateWatch,
    isDisplayingResolvedContent: () => displayedContentStatus === "resolved",
    beginClientFrameReloadForAncestorReload,
    cancelReload,
    startInheritedReload,
    updateMarker,
    renderMarkerContent,
    matchesIdentity: (src, name2) => !disposed && frame.src === src && frameName === name2,
    dispose,
    handle: frame
  };
  async function updateMarker(marker, options) {
    if (disposed || context.lifecycleSignal.aborted || options?.signal?.aborted) return;
    let previousMarker = currentMarker;
    let isInheritedReload = previousMarker !== void 0 && previousMarker.id !== marker.id;
    currentMarker = marker;
    if (isInheritedReload) {
      startInheritedReload(options?.signal);
    }
    if (marker.status === "pending") {
      await watchPendingFrameTemplate(
        marker,
        options?.reconciliationTracker,
        options?.signal,
        isInheritedReload ? () => {
          completeInheritedReload();
        } : void 0
      );
    } else {
      clearPendingFrameTemplateWatch();
      if (isInheritedReload && !options?.signal?.aborted) {
        completeInheritedReload();
      }
    }
  }
  async function renderMarkerContent(marker, content, options) {
    if (disposed || context.lifecycleSignal.aborted || options?.signal?.aborted) return;
    let previousMarker = currentMarker;
    let isInheritedReload = previousMarker !== void 0 && previousMarker.id !== marker.id;
    currentMarker = marker;
    if (isInheritedReload) {
      startInheritedReload(options?.signal);
    }
    clearPendingFrameTemplateWatch();
    await render(content, { ...options, contentStatus: "resolved" });
    if (isInheritedReload && !disposed && !context.lifecycleSignal.aborted && !options?.signal?.aborted) {
      completeInheritedReload();
    }
  }
  async function reload(options) {
    let transition = startReloadTransition(options);
    void transition.committed.catch(() => {
    });
    return await transition.finished;
  }
  function startReloadTransition(options) {
    let controller = startReload(options?.signal);
    let committed = Promise.withResolvers();
    let commitStarted = false;
    let finished = resolveAndRenderReload(controller, options, (ready) => {
      if (commitStarted) return;
      commitStarted = true;
      void ready.then(committed.resolve, committed.reject);
    });
    void finished.then(() => committed.resolve(), committed.reject);
    return { signal: controller.signal, committed: committed.promise, finished };
  }
  function startReload(signal) {
    let controller = replaceReloadController(signal);
    reloadKind = "direct";
    frame.dispatchEvent(new Event("reloadStart"));
    startSubFrameInheritedReloads(getContentNodes(), controller.signal);
    return controller;
  }
  function beginClientFrameReloadForAncestorReload(signal) {
    let inheritedReloadStarted = reuseInheritedReloadStart();
    let continuingAncestorReload = reloadKind === "ancestor";
    let controller = replaceReloadController(signal);
    reloadKind = "ancestor";
    if (!inheritedReloadStarted && !continuingAncestorReload) {
      frame.dispatchEvent(new Event("reloadStart"));
      startSubFrameInheritedReloads(getContentNodes(), controller.signal);
    }
    return {
      controller,
      complete: () => completeReload(controller)
    };
  }
  function cancelReload() {
    let controller = reloadController;
    if (!controller) return;
    controller.abort();
    completeReload(controller);
  }
  function replaceReloadController(signal) {
    reloadController?.abort();
    reloadAbortUnsubscribe?.();
    reloadAbortUnsubscribe = void 0;
    let controller = new AbortController();
    reloadController = controller;
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        let abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        reloadAbortUnsubscribe = () => signal.removeEventListener("abort", abort);
      }
    }
    return controller;
  }
  async function resolveAndRenderReload(controller, options, resolveCommit) {
    try {
      let resolution = await init.resolveFrame(frame.src, {
        ...options,
        signal: controller.signal,
        target: frameName
      });
      if (reloadController !== controller || controller.signal.aborted) {
        return { signal: controller.signal };
      }
      let { content, redirectedTo } = await unwrapFrameResolution(resolution);
      if (reloadController !== controller || controller.signal.aborted) {
        return { signal: controller.signal };
      }
      let reconciliationTracker = createReconciliationTracker();
      let blockingFrameTracker = createReconciliationTracker();
      let commitStarted = false;
      await render(content, {
        signal: controller.signal,
        reconciliationTracker,
        blockingFrameTracker,
        onCommit() {
          if (commitStarted) return;
          commitStarted = true;
          blockingFrameTracker.finalize();
          resolveCommit?.(blockingFrameTracker.ready());
        }
      });
      reconciliationTracker.finalize();
      await reconciliationTracker.ready();
      return {
        signal: controller.signal,
        redirectedTo: reloadController === controller && !controller.signal.aborted ? redirectedTo : void 0
      };
    } catch (error) {
      if (reloadController !== controller || controller.signal.aborted) {
        return { signal: controller.signal };
      }
      init.errorTarget.dispatchEvent(createComponentErrorEvent(error));
      throw error;
    } finally {
      completeReload(controller);
    }
  }
  function completeReload(controller) {
    if (reloadController !== controller || reloadKind === void 0) return;
    reloadAbortUnsubscribe?.();
    reloadAbortUnsubscribe = void 0;
    reloadKind = void 0;
    frame.dispatchEvent(new Event("reloadComplete"));
  }
  function startInheritedReload(signal) {
    if (signal?.aborted) return;
    if (!inheritedReloadPending) {
      inheritedReloadPending = true;
      frame.dispatchEvent(new Event("reloadStart"));
      startSubFrameInheritedReloads(getContentNodes(), signal);
    }
    inheritedReloadAbortUnsubscribe?.();
    inheritedReloadAbortUnsubscribe = void 0;
    if (signal) {
      let abort = () => completeInheritedReload();
      signal.addEventListener("abort", abort, { once: true });
      inheritedReloadAbortUnsubscribe = () => {
        signal.removeEventListener("abort", abort);
      };
    }
  }
  function reuseInheritedReloadStart() {
    if (!inheritedReloadPending) return false;
    inheritedReloadPending = false;
    inheritedReloadAbortUnsubscribe?.();
    inheritedReloadAbortUnsubscribe = void 0;
    return true;
  }
  function completeInheritedReload() {
    if (!inheritedReloadPending) return;
    inheritedReloadPending = false;
    inheritedReloadAbortUnsubscribe?.();
    inheritedReloadAbortUnsubscribe = void 0;
    frame.dispatchEvent(new Event("reloadComplete"));
  }
  function startSubFrameInheritedReloads(nodes, signal) {
    for (let i = 0; i < nodes.length; i++) {
      if (signal?.aborted) break;
      let node = nodes[i];
      if (isFrameStart(node)) {
        let end = findEndMarker(node, isFrameStart, isFrameEnd);
        context.frameInstances.get(node)?.startInheritedReload(signal);
        i = findMarkerRangeEndIndex(nodes, end, i);
        continue;
      }
      if (node.childNodes && node.childNodes.length > 0) {
        startSubFrameInheritedReloads(Array.from(node.childNodes), signal);
      }
    }
  }
  function clearPendingFrameTemplateWatch() {
    pendingTemplateUnsubscribe?.();
    pendingTemplateUnsubscribe = void 0;
    pendingTemplateObserver?.disconnect();
    pendingTemplateObserver = void 0;
    pendingTemplateMarkerId = void 0;
  }
  async function watchPendingFrameTemplate(marker, reconciliationTracker, signal, onResolved) {
    if (disposed || context.lifecycleSignal.aborted || signal?.aborted) return;
    if (pendingTemplateMarkerId === marker.id) return;
    clearPendingFrameTemplateWatch();
    pendingTemplateMarkerId = marker.id;
    let early = consumeFrameTemplate(marker.id) ?? getEarlyFrameContent(marker.id);
    if (early) {
      clearPendingFrameTemplateWatch();
      await render(early, { reconciliationTracker, signal, contentStatus: "resolved" });
      if (!disposed && !context.lifecycleSignal.aborted && !signal?.aborted) onResolved?.();
      return;
    }
    if (disposed || context.lifecycleSignal.aborted || signal?.aborted) {
      clearPendingFrameTemplateWatch();
      return;
    }
    let observer = setupTemplateObserver();
    pendingTemplateObserver = observer;
    let unsubscribe = subscribeFrameTemplate(marker.id, async (fragment) => {
      if (disposed || context.lifecycleSignal.aborted || signal?.aborted) return;
      if (pendingTemplateMarkerId !== marker.id) return;
      clearPendingFrameTemplateWatch();
      await render(fragment, { signal, contentStatus: "resolved" });
      if (!disposed && !context.lifecycleSignal.aborted && !signal?.aborted) onResolved?.();
    });
    pendingTemplateUnsubscribe = unsubscribe;
    signal?.addEventListener(
      "abort",
      () => {
        if (pendingTemplateMarkerId === marker.id) {
          clearPendingFrameTemplateWatch();
        }
      },
      { once: true }
    );
    let buffered = consumeFrameTemplate(marker.id);
    if (buffered) {
      clearPendingFrameTemplateWatch();
      await render(buffered, { reconciliationTracker, signal, contentStatus: "resolved" });
      if (!disposed && !context.lifecycleSignal.aborted && !signal?.aborted) onResolved?.();
    }
  }
}
function createFrameRuntime(init) {
  return {
    [FRAME_RUNTIME]: true,
    topFrame: init.topFrame,
    errorTarget: init.errorTarget,
    loadModule: init.loadModule,
    resolveFrame: init.resolveFrame,
    pendingClientEntries: init.pendingClientEntries,
    scheduler: init.scheduler,
    styleManager: init.styleManager,
    moduleCache: init.moduleCache,
    moduleLoads: init.moduleLoads,
    frameInstances: init.frameInstances,
    namedFrames: init.namedFrames,
    serverFrameReload: void 0,
    reloadForNavigation: init.reloadForNavigation
  };
}
function createReconciliationTracker() {
  let pending = 0;
  let finalized = false;
  let failed = false;
  let failure;
  let resolveReady;
  let rejectReady;
  let readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  function maybeSettle() {
    if (!finalized || pending !== 0) return;
    if (failed) rejectReady?.(failure);
    else resolveReady?.();
    resolveReady = void 0;
    rejectReady = void 0;
  }
  function track() {
    pending++;
    let completed = false;
    return () => {
      if (completed) return;
      completed = true;
      pending--;
      maybeSettle();
    };
  }
  return {
    track,
    waitFor(task) {
      let complete = track();
      void task.then(complete, (error) => {
        if (!failed) {
          failed = true;
          failure = error;
        }
        complete();
      });
    },
    finalize() {
      finalized = true;
      maybeSettle();
    },
    ready() {
      return readyPromise;
    }
  };
}
function mergeRmxDataFromDocument(into, doc) {
  let scripts = Array.from(doc.querySelectorAll("script#rmx-data"));
  for (let script of scripts) {
    if (!(script instanceof HTMLScriptElement)) continue;
    mergeRmxData(into, parseRmxDataScript(script));
    script.remove();
  }
}
function mergeRmxDataFromFragment(into, fragment) {
  let scripts = Array.from(fragment.querySelectorAll("script#rmx-data"));
  for (let script of scripts) {
    if (!(script instanceof HTMLScriptElement)) continue;
    mergeRmxData(into, parseRmxDataScript(script));
    script.remove();
  }
}
function clearRmxData(data) {
  delete data.h;
  delete data.f;
}
function removeEmptyHeads(fragment) {
  let heads = Array.from(fragment.querySelectorAll("head"));
  for (let head of heads) {
    if (!head.childNodes.length) {
      head.remove();
    }
  }
}
function collectFrameServerStyleTags(container) {
  let styles = [];
  let nodes = container.root instanceof Document ? [...Array.from(container.doc.head.childNodes), ...Array.from(container.doc.body.childNodes)] : container.childNodes;
  collectOwnedServerStyleTags(nodes, styles);
  return styles;
}
function collectOwnedServerStyleTags(nodes, styles) {
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (isFrameStart(node)) {
      let end = findEndMarker(node, isFrameStart, isFrameEnd);
      i = findMarkerRangeEndIndex(nodes, end, i);
      continue;
    }
    if (node instanceof HTMLStyleElement && node.matches("style[data-rmx-style]")) {
      styles.push(node);
      continue;
    }
    if (node.childNodes.length > 0) {
      collectOwnedServerStyleTags(Array.from(node.childNodes), styles);
    }
  }
}
function parseRmxDataScript(script) {
  try {
    return JSON.parse(script.textContent || "{}");
  } catch {
    console.error("[createFrame] Failed to parse rmx-data script");
    return {};
  }
}
function mergeRmxData(into, from) {
  if (from.h) {
    if (!into.h) into.h = {};
    copyOwnRmxEntries(into.h, from.h);
  }
  if (from.f) {
    if (!into.f) into.f = {};
    copyOwnRmxEntries(into.f, from.f);
  }
}
function copyOwnRmxEntries(target, source) {
  for (let key of Object.keys(source)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (!Object.hasOwn(source, key)) continue;
    target[key] = source[key];
  }
}
function scheduleHydrationInContainer(container, context, reconciliationTracker, signal) {
  let hydrationMarkers = findHydrationMarkers(container);
  if (hydrationMarkers.length === 0) return;
  let hydrationData = context.data.h;
  if (!hydrationData) return;
  for (let marker of hydrationMarkers) {
    let entry = hydrationData[marker.id];
    if (!entry) continue;
    scheduleHydrationMarker(marker, entry, context, reconciliationTracker, signal);
  }
}
function scheduleHydrationMarker(marker, entry, context, reconciliationTracker, signal) {
  if (signal?.aborted || context.lifecycleSignal.aborted) return;
  let done = reconciliationTracker?.track();
  let key = `${entry.moduleUrl}#${entry.exportName}`;
  let identity = {
    moduleUrl: entry.moduleUrl,
    exportName: entry.exportName
  };
  let props = entry.props;
  let completed = false;
  let complete = () => {
    if (completed) return;
    completed = true;
    props = void 0;
    signal?.removeEventListener("abort", complete);
    context.lifecycleSignal.removeEventListener("abort", complete);
    done?.();
  };
  signal?.addEventListener("abort", complete, { once: true });
  context.lifecycleSignal.addEventListener("abort", complete, { once: true });
  let hydrateWithComponent = (component) => {
    if (signal?.aborted || context.lifecycleSignal.aborted) return;
    if (!isHydrationMarkerLive(marker, context)) return;
    if (!props) return;
    let vElement = createElement(component, props);
    context.pendingClientEntries.set(marker.start, [marker.end, vElement]);
    hydrateRegion(vElement, marker.start, marker.end, identity, context, signal);
  };
  let cached = context.moduleCache.get(key);
  if (cached) {
    hydrateWithComponent(cached);
    complete();
    return;
  }
  getOrStartModuleLoad(key, identity, marker.id, context).then((component) => {
    if (component) {
      hydrateWithComponent(component);
    }
  }).finally(() => {
    complete();
  });
}
function getOrStartModuleLoad(key, identity, markerId, context) {
  let inFlight = context.moduleLoads.get(key);
  if (inFlight) return inFlight;
  let loadPromise = (async () => {
    try {
      let mod = await context.loadModule(identity.moduleUrl, identity.exportName);
      if (!isElementFunction3(mod)) {
        throw new Error(
          `Export "${identity.exportName}" from "${identity.moduleUrl}" is not a function`
        );
      }
      context.moduleCache.set(key, mod);
      return mod;
    } catch (error) {
      console.error(`[createFrame] Failed to load module for ${markerId}:`, error);
      return void 0;
    } finally {
      context.moduleLoads.delete(key);
    }
  })();
  context.moduleLoads.set(key, loadPromise);
  return loadPromise;
}
function createElement(component, props) {
  let revivedProps = reviveSerializedValue(props);
  invariant(isRecord(revivedProps), "Expected revived component props to be an object");
  return jsx(component, revivedProps);
}
function isElementFunction3(value) {
  return typeof value === "function";
}
function reviveSerializedValue(value) {
  if (value === null || value === void 0) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => reviveSerializedValue(item));
  }
  if (!isRecord(value)) return value;
  let record = value;
  if (record.$rmxFrame === true) {
    let props = reviveSerializedObject(record.props);
    let key = reviveSerializedValue(record.key);
    return jsx(Frame, props, key);
  }
  if (record.$rmx === true && typeof record.type === "string") {
    let props = reviveSerializedObject(record.props);
    let key = reviveSerializedValue(record.key);
    return jsx(record.type, props, key);
  }
  let revived = {};
  for (let key in record) {
    revived[key] = reviveSerializedValue(record[key]);
  }
  return revived;
}
function reviveSerializedObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  let revived = reviveSerializedValue(value);
  if (!revived || typeof revived !== "object" || Array.isArray(revived)) return {};
  return isRecord(revived) ? revived : {};
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hydrateRegion(vElement, start, end, identity, context, signal) {
  if (signal?.aborted) return;
  context.pendingClientEntries.delete(start);
  let renderEntry = (root3) => {
    if (!signal) {
      root3.render(vElement);
      return;
    }
    let frameRuntime = context.frame.$runtime;
    invariant(
      isFrameRuntime(frameRuntime),
      "Expected frame runtime while rendering a client entry during a reload"
    );
    let previousServerFrameReload = frameRuntime.serverFrameReload;
    frameRuntime.serverFrameReload = {
      signal,
      reconciliationTracker: context.reconciliationTracker,
      blockingFrameTracker: context.blockingFrameTracker
    };
    try {
      root3.render(vElement);
    } finally {
      frameRuntime.serverFrameReload = previousServerFrameReload;
    }
  };
  let owner = getClientEntryBoundaryOwner(start);
  if (owner) {
    renderEntry(owner.root);
    return;
  }
  let root2 = createRangeRoot([start, end], {
    scheduler: context.scheduler,
    frame: context.frame,
    styleManager: context.styleManager
  });
  root2.addEventListener("error", (event) => {
    if (context.errorTarget === root2) return;
    context.errorTarget.dispatchEvent(createComponentErrorEvent(getComponentError(event)));
  });
  setClientEntryBoundaryOwner(start, identity, root2);
  renderEntry(root2);
}
async function createSubFrames(nodes, context, options) {
  let tasks = [];
  for (let i = 0; i < nodes.length; i++) {
    if (options?.signal?.aborted) break;
    let node = nodes[i];
    if (isFrameStart(node)) {
      let end = findEndMarker(node, isFrameStart, isFrameEnd);
      let existingFrame = context.frameInstances.get(node);
      let id = getFrameId2(node);
      let marker = context.data.f?.[id];
      if (existingFrame) {
        if (marker) {
          let frameMarker = { ...marker, id };
          tasks.push(existingFrame.updateMarker(frameMarker, options));
        } else {
          existingFrame.clearPendingTemplateWatch();
        }
      } else {
        if (marker) {
          let frameMarker = { ...marker, id };
          let subFrame = createFrame([node, end], {
            src: frameMarker.src,
            marker: frameMarker,
            topFrame: context.topFrame,
            errorTarget: context.errorTarget,
            loadModule: context.loadModule,
            resolveFrame: context.resolveFrame,
            pendingClientEntries: context.pendingClientEntries,
            scheduler: context.scheduler,
            styleManager: context.styleManager,
            data: context.data,
            moduleCache: context.moduleCache,
            moduleLoads: context.moduleLoads,
            frameInstances: context.frameInstances,
            namedFrames: context.namedFrames
          });
          context.frameInstances.set(node, subFrame);
          if (frameMarker.status === "resolved") {
            tasks.push(subFrame.ready());
          }
        }
      }
      i = findMarkerRangeEndIndex(nodes, end, i);
      continue;
    }
    if (node.childNodes && node.childNodes.length > 0) {
      tasks.push(createSubFrames(Array.from(node.childNodes), context, options));
    }
  }
  await Promise.all(tasks);
}
function isHydrationMarkerLive(marker, context) {
  if (!marker.start.isConnected || !marker.end.isConnected) return false;
  if (marker.start.parentNode !== marker.end.parentNode) return false;
  let startText = marker.start.data.trim();
  if (startText !== `rmx:h:${marker.id}`) return false;
  if (marker.end.data.trim() !== "/rmx:h") return false;
  let parent = marker.start.parentNode;
  if (!parent) return false;
  if (context.regionTailRef) {
    let startPosition = marker.start.compareDocumentPosition(context.regionTailRef);
    let endPosition = marker.end.compareDocumentPosition(context.regionTailRef);
    let tailFollowsStart = (startPosition & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    let tailFollowsEnd = (endPosition & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    if (!tailFollowsStart || !tailFollowsEnd) return false;
  }
  return true;
}
function removeVirtualRoots(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (isCommentNode3(node) && isHydrationStart(node) && disposeClientEntryBoundary(node)) {
      let end = findEndMarker(node, isHydrationStart, isHydrationEnd);
      i = findMarkerRangeEndIndex(nodes, end, i);
      continue;
    }
    if (node.childNodes && node.childNodes.length > 0) {
      removeVirtualRoots(Array.from(node.childNodes));
    }
  }
}
function disposeSubFrames(nodes, context) {
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (isFrameStart(node)) {
      let end = findEndMarker(node, isFrameStart, isFrameEnd);
      let subFrame = context.frameInstances.get(node);
      if (subFrame) {
        subFrame.dispose();
        context.frameInstances.delete(node);
      }
      i = findMarkerRangeEndIndex(nodes, end, i);
      continue;
    }
    if (node.childNodes && node.childNodes.length > 0) {
      disposeSubFrames(Array.from(node.childNodes), context);
    }
  }
}
function getEarlyFrameContent(id) {
  let template = document.querySelector(`template#${id}`);
  if (template instanceof HTMLTemplateElement) {
    let fragment = template.content;
    template.remove();
    return fragment;
  }
  return null;
}
function setupTemplateObserver() {
  let root2 = document.body ?? document.documentElement ?? document;
  let observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
      for (let node of mutation.addedNodes) {
        collectAndPublishTemplates(node);
      }
    }
  });
  observer.observe(root2, { childList: true, subtree: true });
  return observer;
}
function collectAndPublishTemplates(node) {
  if (node instanceof HTMLTemplateElement) {
    publishFrameTemplateElement(node);
    return;
  }
  if (!(node instanceof Element)) return;
  let templates = Array.from(node.querySelectorAll("template"));
  for (let template of templates) {
    if (!(template instanceof HTMLTemplateElement)) continue;
    publishFrameTemplateElement(template);
  }
}
function publishFrameTemplateElement(template) {
  if (!template.id) return;
  template.remove();
  publishFrameTemplate(template.id, template.content);
}
function publishFrameTemplate(id, fragment) {
  let listeners = frameTemplateListeners.get(id);
  if (!listeners || listeners.size === 0) {
    let queue = bufferedFrameTemplates.get(id);
    if (!queue) {
      queue = [];
      bufferedFrameTemplates.set(id, queue);
    }
    queue.push(fragment);
    return;
  }
  for (let listener of listeners) {
    let clone = fragment.cloneNode(true);
    invariant(isDocumentFragmentNode(clone), "Expected cloned frame template fragment");
    listener(clone);
  }
}
function consumeFrameTemplate(id) {
  let queue = bufferedFrameTemplates.get(id);
  if (!queue || queue.length === 0) return null;
  let fragment = queue.shift() ?? null;
  if (queue.length === 0) {
    bufferedFrameTemplates.delete(id);
  }
  return fragment;
}
function subscribeFrameTemplate(id, listener) {
  let listeners = frameTemplateListeners.get(id);
  if (!listeners) {
    listeners = /* @__PURE__ */ new Set();
    frameTemplateListeners.set(id, listeners);
  }
  listeners.add(listener);
  return () => {
    let current = frameTemplateListeners.get(id);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      frameTemplateListeners.delete(id);
    }
  };
}
var COMPLETE_TEMPLATE_WITH_ID_PATTERN = /<template\b[^>]*\bid=(?:"([^"]+)"|'([^']+)')[^>]*>[\s\S]*?<\/template>/gi;
function extractTemplatesFromBuffer(doc, buffer, onTemplate) {
  let html = "";
  let cursor = 0;
  let hadMatch = false;
  COMPLETE_TEMPLATE_WITH_ID_PATTERN.lastIndex = 0;
  let match = COMPLETE_TEMPLATE_WITH_ID_PATTERN.exec(buffer);
  while (match) {
    hadMatch = true;
    let index = match.index;
    let fullMatch = match[0];
    let id = match[1] ?? match[2];
    let matchEnd = index + fullMatch.length;
    html += buffer.slice(cursor, index);
    if (id) {
      let parsed = createFragmentFromString(doc, fullMatch);
      let template = parsed.querySelector("template");
      if (template instanceof HTMLTemplateElement && template.id) {
        onTemplate(template.id, template.content);
      }
    }
    cursor = matchEnd;
    match = COMPLETE_TEMPLATE_WITH_ID_PATTERN.exec(buffer);
  }
  let tail = buffer.slice(cursor);
  if (tail === "") return { html, remainder: "" };
  let tailStart = tail.toLowerCase().lastIndexOf("<template");
  if (tailStart === -1) {
    return { html: html + tail, remainder: "" };
  }
  if (!hadMatch) {
    return {
      html: buffer.slice(0, tailStart),
      remainder: buffer.slice(tailStart)
    };
  }
  return {
    html: html + tail.slice(0, tailStart),
    remainder: tail.slice(tailStart)
  };
}
async function renderFrameStream(stream, doc, applyHtml, signal) {
  let reader = stream.getReader();
  let decoder = new TextDecoder();
  let buffer = "";
  let html = "";
  let appliedOnce = false;
  let abort = () => {
    void reader.cancel().catch(() => {
    });
  };
  if (signal?.aborted) {
    await reader.cancel();
    reader.releaseLock();
    return;
  }
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      let { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let parsed2 = extractTemplatesFromBuffer(doc, buffer, publishFrameTemplate);
      buffer = parsed2.remainder;
      if (parsed2.html !== "") {
        html += parsed2.html;
        let flushed = await consumeFlushBatches(html, applyHtml);
        appliedOnce = flushed.applied || appliedOnce;
        html = flushed.remainder;
      }
    }
    buffer += decoder.decode();
    let parsed = extractTemplatesFromBuffer(doc, buffer, publishFrameTemplate);
    html += parsed.html;
    buffer = parsed.remainder;
    if (buffer !== "") {
      html += buffer;
      buffer = "";
    }
    if (html !== "") {
      await applyHtml(html, "fragment");
      appliedOnce = true;
    }
    if (html === "" && !appliedOnce) {
      await applyHtml("", "fragment");
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
async function consumeFlushBatches(html, applyHtml) {
  let applied = false;
  let cursor = 0;
  let marker = findFlushMarker(html, cursor);
  while (marker) {
    let batch = html.slice(cursor, marker.index);
    await applyHtml(batch, marker.kind);
    applied = true;
    cursor = marker.endIndex;
    marker = findFlushMarker(html, cursor);
  }
  return { applied, remainder: html.slice(cursor) };
}
function createContainer(root2) {
  return Array.isArray(root2) ? createCommentContainer(root2) : createElementContainer(root2);
}
function createElementContainer(root2) {
  let doc = root2 instanceof Document ? root2 : root2.ownerDocument ?? document;
  return {
    doc,
    root: root2,
    get childNodes() {
      return Array.from(root2.childNodes);
    }
  };
}
function createCommentContainer([start, end]) {
  let parent = end.parentNode;
  invariant(parent, "Invalid comment container");
  invariant(start.parentNode === parent, "Boundaries must share parent");
  let doc = parent.ownerDocument ?? document;
  let getChildNodesBetween = () => {
    let nodes = [];
    let node = start.nextSibling;
    while (node && node !== end) {
      nodes.push(node);
      node = node.nextSibling;
    }
    return nodes;
  };
  return {
    doc,
    root: parent,
    get childNodes() {
      return getChildNodesBetween();
    },
    regionTailRef: end,
    regionParent: parent
  };
}
function createFragmentFromString(doc, content) {
  let template = doc.createElement("template");
  template.innerHTML = stripDoctypeMarkup(content).trim();
  return template.content;
}
function isRemixNodeFrameContent(content) {
  return !(content instanceof ReadableStream || isDocumentFragmentNode(content) || typeof content === "string");
}
function findHydrationMarkers(container) {
  let results = [];
  forEachComment(container, (comment) => {
    let trimmed = comment.data.trim();
    if (!trimmed.startsWith("rmx:h:")) return;
    let id = trimmed.slice("rmx:h:".length);
    let end = findEndMarker(comment, isHydrationStart, isHydrationEnd);
    results.push({ id, start: comment, end });
  });
  return results;
}
function forEachComment(container, cb) {
  walkCommentsInNodes(container.childNodes, cb);
}
function walkCommentsInNodes(nodes, cb) {
  for (let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    if (isFrameStart(node)) {
      let end = findEndMarker(node, isFrameStart, isFrameEnd);
      i = findMarkerRangeEndIndex(nodes, end, i);
      continue;
    }
    if (isCommentNode3(node)) cb(node);
    if (node.childNodes && node.childNodes.length > 0) {
      walkCommentsInNodes(Array.from(node.childNodes), cb);
    }
  }
}
function isHydrationStart(node) {
  return node.data.trim().startsWith("rmx:h:");
}
function isHydrationEnd(node) {
  return node.data.trim() === "/rmx:h";
}
function isFrameStart(node) {
  return isCommentNode3(node) && node.data.trim().startsWith("rmx:f:");
}
function isFrameEnd(node) {
  return node.data.trim() === "/rmx:f";
}
function getFrameId2(start) {
  let trimmed = start.data.trim();
  invariant(trimmed.startsWith("rmx:f:"), "Invalid frame start marker");
  return trimmed.slice("rmx:f:".length);
}
function findMarkerRangeEndIndex(nodes, end, startIndex) {
  return Math.max(startIndex, nodes.indexOf(end));
}
function findEndMarker(start, isStart, isEnd) {
  let node = start.nextSibling;
  let depth = 1;
  while (node) {
    if (isCommentNode3(node)) {
      let comment = node;
      if (isStart(comment)) depth++;
      else if (isEnd(comment)) {
        depth--;
        if (depth === 0) return comment;
      }
    }
    node = node.nextSibling;
  }
  throw new Error("End marker not found");
}
function isCommentNode3(node) {
  return node?.nodeType === Node.COMMENT_NODE;
}
function isDocumentNode(node) {
  return node.nodeType === Node.DOCUMENT_NODE;
}
function isDocumentFragmentNode(value) {
  return typeof value === "object" && value !== null && Reflect.get(value, "nodeType") === Node.DOCUMENT_FRAGMENT_NODE;
}

// index.tsx
var name = "remix";
function Button(handle) {
  return () => /* @__PURE__ */ jsx("div", { class: "col-sm-6 smallpad", children: /* @__PURE__ */ jsx(
    "button",
    {
      id: handle.props.id,
      class: "btn btn-primary btn-block",
      type: "button",
      mix: [on("click", handle.props.fn)],
      children: handle.props.text
    }
  ) });
}
function MetricCard(handle) {
  let selected = false;
  let hovered = false;
  return () => {
    let { label, value, change } = handle.props;
    return /* @__PURE__ */ jsx(
      "div",
      {
        class: `metric-card ${selected ? "selected" : ""}`,
        mix: [
          on("click", () => {
            selected = !selected;
            handle.update();
          }),
          on("mouseenter", () => {
            hovered = true;
            handle.update();
          }),
          on("mouseleave", () => {
            hovered = false;
            handle.update();
          }),
          on("focus", (e) => {
            e.currentTarget.style.outline = "2px solid #222";
            e.currentTarget.style.outlineOffset = "2px";
          }),
          on("blur", (e) => {
            e.currentTarget.style.outline = "";
          })
        ],
        tabIndex: 0,
        style: {
          backgroundColor: hovered ? "#f5f5f5" : "#fff",
          transform: hovered && !selected ? "translateY(-2px)" : "translateY(0)",
          transition: "all 0.2s",
          padding: "20px",
          border: "1px solid #ddd",
          borderRadius: "8px",
          cursor: "pointer",
          boxShadow: selected ? "0 4px 8px rgba(0,0,0,0.1)" : "0 2px 4px rgba(0,0,0,0.05)"
        },
        children: [
          /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", color: "#666", marginBottom: "8px" }, children: label }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: "24px", fontWeight: "bold", marginBottom: "4px" }, children: value }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: change.startsWith("+") ? "#28a745" : "#dc3545" }, children: change })
        ]
      }
    );
  };
}
function ChartBar(handle) {
  let hovered = false;
  return () => /* @__PURE__ */ jsx(
    "div",
    {
      class: "chart-bar",
      mix: [
        on("click", () => {
        }),
        on("mouseenter", () => {
          hovered = true;
          handle.update();
        }),
        on("mouseleave", () => {
          hovered = false;
          handle.update();
        }),
        on("focus", (e) => {
          e.currentTarget.style.outline = "2px solid #222";
          e.currentTarget.style.outlineOffset = "2px";
        }),
        on("blur", (e) => {
          e.currentTarget.style.outline = "";
        })
      ],
      style: {
        height: `${handle.props.value}%`,
        backgroundColor: hovered ? "#286090" : "#337ab7",
        width: "30px",
        margin: "0 2px",
        cursor: "pointer",
        transition: "all 0.2s",
        opacity: hovered ? 0.9 : 1,
        transform: hovered ? "scaleY(1.1)" : "scaleY(1)"
      },
      tabIndex: 0
    }
  );
}
function ActivityItem(handle) {
  let read = false;
  let hovered = false;
  return () => {
    let { title, time, icon } = handle.props;
    return /* @__PURE__ */ jsx(
      "li",
      {
        class: `activity-item ${read ? "read" : ""}`,
        mix: [
          on("click", () => {
            read = !read;
            handle.update();
          }),
          on("mouseenter", () => {
            hovered = true;
            handle.update();
          }),
          on("mouseleave", () => {
            hovered = false;
            handle.update();
          })
        ],
        style: {
          padding: "12px",
          borderBottom: "1px solid #eee",
          cursor: "pointer",
          backgroundColor: hovered ? "#f5f5f5" : read ? "rgba(245, 245, 245, 0.6)" : "#fff",
          display: "flex",
          alignItems: "center",
          gap: "12px"
        },
        children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              style: {
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                backgroundColor: "#337ab7",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold"
              },
              children: icon
            }
          ),
          /* @__PURE__ */ jsx("div", { style: { flex: 1 }, children: [
            /* @__PURE__ */ jsx("div", { style: { fontWeight: read ? "normal" : "bold" }, children: title }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "#666" }, children: time })
          ] })
        ]
      }
    );
  };
}
function DropdownMenu(handle) {
  let open = false;
  let hovered = false;
  let actions = ["View Details", "Edit", "Duplicate", "Archive", "Delete"];
  return () => /* @__PURE__ */ jsx("div", { style: { position: "relative", display: "inline-block" }, children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        class: "btn btn-primary",
        mix: [
          on("click", (e) => {
            e.stopPropagation();
            open = !open;
            handle.update();
          }),
          on("mouseenter", () => {
            hovered = true;
            handle.update();
          }),
          on("mouseleave", () => {
            hovered = false;
            handle.update();
          }),
          on("focus", (e) => {
            e.currentTarget.style.outline = "2px solid #222";
            e.currentTarget.style.outlineOffset = "2px";
          }),
          on("blur", (e) => {
            e.currentTarget.style.outline = "";
          })
        ],
        style: {
          padding: "4px 8px",
          fontSize: "12px",
          backgroundColor: hovered ? "#286090" : "#337ab7"
        },
        children: "\u22EE"
      }
    ),
    open && /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "absolute",
          top: "100%",
          right: 0,
          backgroundColor: "#fff",
          border: "1px solid #ddd",
          borderRadius: "4px",
          boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
          zIndex: 1e3,
          minWidth: "150px",
          marginTop: "4px"
        },
        mix: [
          on("mouseleave", () => {
            open = false;
            handle.update();
          })
        ],
        children: actions.map((action, idx) => /* @__PURE__ */ jsx(
          "div",
          {
            mix: [
              on("click", (e) => {
                e.stopPropagation();
                open = false;
                handle.update();
              }),
              on("mouseenter", (e) => {
                e.currentTarget.style.backgroundColor = "#f5f5f5";
              }),
              on("mouseleave", (e) => {
                e.currentTarget.style.backgroundColor = "#fff";
              })
            ],
            style: {
              padding: "8px 12px",
              cursor: "pointer",
              borderBottom: idx < actions.length - 1 ? "1px solid #eee" : "none"
            },
            children: action
          },
          idx
        ))
      }
    )
  ] });
}
function DashboardTableRow(handle) {
  let hovered = false;
  let selected = false;
  return () => {
    let { row } = handle.props;
    return /* @__PURE__ */ jsx(
      "tr",
      {
        class: selected ? "danger" : "",
        mix: [
          on("click", () => {
            selected = !selected;
            handle.update();
          }),
          on("mouseenter", () => {
            hovered = true;
            handle.update();
          }),
          on("mouseleave", () => {
            hovered = false;
            handle.update();
          })
        ],
        style: {
          backgroundColor: hovered ? "#f5f5f5" : "#fff",
          cursor: "pointer"
        },
        children: [
          /* @__PURE__ */ jsx("td", { style: { padding: "12px", borderTop: "1px solid #ddd" }, children: row.id }),
          /* @__PURE__ */ jsx("td", { style: { padding: "12px", borderTop: "1px solid #ddd" }, children: row.label }),
          /* @__PURE__ */ jsx("td", { style: { padding: "12px", borderTop: "1px solid #ddd" }, children: /* @__PURE__ */ jsx("span", { style: { color: "#28a745" }, children: "Active" }) }),
          /* @__PURE__ */ jsx("td", { style: { padding: "12px", borderTop: "1px solid #ddd" }, children: [
            "$",
            (row.id * 10.5).toFixed(2)
          ] }),
          /* @__PURE__ */ jsx("td", { style: { padding: "12px", borderTop: "1px solid #ddd" }, children: /* @__PURE__ */ jsx(DropdownMenu, { rowId: row.id }) })
        ]
      }
    );
  };
}
function SearchInput(handle) {
  let value = "";
  let focused = false;
  return () => /* @__PURE__ */ jsx(
    "input",
    {
      type: "text",
      placeholder: "Search...",
      value,
      mix: [
        on("input", (e) => {
          value = e.target.value;
          handle.update();
        }),
        on("focus", () => {
          focused = true;
          handle.update();
        }),
        on("blur", () => {
          focused = false;
          handle.update();
        })
      ],
      style: {
        padding: "8px 12px",
        border: `1px solid ${focused ? "#337ab7" : "#ddd"}`,
        borderRadius: "4px",
        fontSize: "14px",
        width: "300px",
        outline: focused ? "2px solid #337ab7" : "none",
        outlineOffset: "2px"
      }
    }
  );
}
function FormWidgets(handle) {
  let selectValue = "option1";
  let checkboxValues = /* @__PURE__ */ new Set();
  let radioValue = "radio1";
  let toggleValue = false;
  let progressValue = 45;
  return () => /* @__PURE__ */ jsx("div", { style: { padding: "20px", backgroundColor: "#f9f9f9", borderRadius: "8px" }, children: [
    /* @__PURE__ */ jsx("h3", { style: { marginTop: 0, marginBottom: "16px" }, children: "Settings" }),
    /* @__PURE__ */ jsx("div", { style: { marginBottom: "16px" }, children: [
      /* @__PURE__ */ jsx("label", { style: { display: "block", marginBottom: "4px", fontSize: "14px" }, children: "Select Option" }),
      /* @__PURE__ */ jsx(
        "select",
        {
          value: selectValue,
          mix: [
            on("change", (e) => {
              selectValue = e.target.value;
              handle.update();
            }),
            on("focus", (e) => {
              e.currentTarget.style.borderColor = "#337ab7";
              e.currentTarget.style.outline = "2px solid #337ab7";
              e.currentTarget.style.outlineOffset = "2px";
            }),
            on("blur", (e) => {
              e.currentTarget.style.borderColor = "#ddd";
              e.currentTarget.style.outline = "none";
            })
          ],
          style: {
            padding: "6px 12px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            fontSize: "14px",
            width: "100%"
          },
          children: [
            /* @__PURE__ */ jsx("option", { value: "option1", children: "Option 1" }),
            /* @__PURE__ */ jsx("option", { value: "option2", children: "Option 2" }),
            /* @__PURE__ */ jsx("option", { value: "option3", children: "Option 3" }),
            /* @__PURE__ */ jsx("option", { value: "option4", children: "Option 4" })
          ]
        }
      )
    ] }),
    ["Checkbox 1", "Checkbox 2", "Checkbox 3"].map((label, idx) => /* @__PURE__ */ jsx(
      "div",
      {
        style: { marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" },
        children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "checkbox",
              id: `checkbox-${idx}`,
              checked: checkboxValues.has(`checkbox-${idx}`),
              mix: [
                on("change", (e) => {
                  if (e.target.checked) {
                    checkboxValues.add(`checkbox-${idx}`);
                  } else {
                    checkboxValues.delete(`checkbox-${idx}`);
                  }
                  handle.update();
                }),
                on("focus", (e) => {
                  e.currentTarget.style.outline = "2px solid #337ab7";
                  e.currentTarget.style.outlineOffset = "2px";
                }),
                on("blur", (e) => {
                  e.currentTarget.style.outline = "";
                })
              ]
            }
          ),
          /* @__PURE__ */ jsx("label", { for: `checkbox-${idx}`, style: { fontSize: "14px", cursor: "pointer" }, children: label })
        ]
      },
      idx
    )),
    /* @__PURE__ */ jsx("div", { style: { marginBottom: "16px" }, children: ["Radio 1", "Radio 2", "Radio 3"].map((label, idx) => /* @__PURE__ */ jsx("label", { style: { display: "block", marginBottom: "8px", cursor: "pointer" }, children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "radio",
          name: "radio-group",
          value: `radio${idx + 1}`,
          checked: radioValue === `radio${idx + 1}`,
          mix: [
            on("change", (e) => {
              radioValue = e.target.value;
              handle.update();
            }),
            on("focus", (e) => {
              e.currentTarget.style.outline = "2px solid #337ab7";
              e.currentTarget.style.outlineOffset = "2px";
            }),
            on("blur", (e) => {
              e.currentTarget.style.outline = "";
            })
          ],
          style: { marginRight: "8px" }
        }
      ),
      label
    ] }, idx)) }),
    /* @__PURE__ */ jsx("div", { style: { marginBottom: "16px" }, children: [
      /* @__PURE__ */ jsx("label", { style: { display: "block", marginBottom: "4px", fontSize: "14px" }, children: "Toggle Switch" }),
      /* @__PURE__ */ jsx(
        "label",
        {
          style: {
            display: "inline-block",
            position: "relative",
            width: "50px",
            height: "24px",
            cursor: "pointer"
          },
          children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "checkbox",
                checked: toggleValue,
                mix: [
                  on("change", (e) => {
                    toggleValue = e.target.checked;
                    handle.update();
                  }),
                  on("focus", (e) => {
                    e.currentTarget.style.outline = "2px solid #222";
                    e.currentTarget.style.outlineOffset = "2px";
                  }),
                  on("blur", (e) => {
                    e.currentTarget.style.outline = "";
                  })
                ],
                style: { opacity: 0, width: 0, height: 0 }
              }
            ),
            /* @__PURE__ */ jsx(
              "span",
              {
                style: {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: toggleValue ? "#337ab7" : "#ccc",
                  borderRadius: "24px",
                  transition: "background-color 0.3s"
                },
                children: /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      position: "absolute",
                      content: '""',
                      height: "18px",
                      width: "18px",
                      left: "3px",
                      bottom: "3px",
                      backgroundColor: "#fff",
                      borderRadius: "50%",
                      transition: "transform 0.3s",
                      transform: toggleValue ? "translateX(26px)" : "translateX(0)"
                    }
                  }
                )
              }
            )
          ]
        }
      )
    ] }),
    /* @__PURE__ */ jsx("div", { children: [
      /* @__PURE__ */ jsx("label", { style: { display: "block", marginBottom: "4px", fontSize: "14px" }, children: "Progress Bar" }),
      /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            width: "100%",
            height: "24px",
            backgroundColor: "#eee",
            borderRadius: "4px",
            overflow: "hidden",
            position: "relative"
          },
          children: /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                width: `${progressValue}%`,
                height: "100%",
                backgroundColor: "#337ab7",
                transition: "width 0.3s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: "12px"
              },
              children: [
                progressValue,
                "%"
              ]
            }
          )
        }
      )
    ] })
  ] });
}
function Dashboard(handle) {
  let dashboardRows = buildData(300);
  let sortDashboardAsc = () => {
    dashboardRows = sortRows(dashboardRows, true);
    handle.update();
  };
  let sortDashboardDesc = () => {
    dashboardRows = sortRows(dashboardRows, false);
    handle.update();
  };
  let chartData = [65, 45, 78, 52, 89, 34, 67, 91, 43, 56, 72, 38, 55, 82, 47, 63, 71, 39, 58, 84];
  let activities = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    title: `Activity ${i + 1}: ${["Order placed", "Payment received", "Shipment created", "Customer registered", "Product updated"][i % 5]}`,
    time: `${i + 1} ${i === 0 ? "minute" : "minutes"} ago`,
    icon: ["O", "P", "S", "C", "U"][i % 5]
  }));
  return () => /* @__PURE__ */ jsx("div", { class: "container", style: { maxWidth: "1400px" }, children: [
    /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          display: "flex",
          marginBottom: "20px",
          alignItems: "center",
          justifyContent: "space-between"
        },
        children: [
          /* @__PURE__ */ jsx("h1", { style: { margin: 0 }, children: "Dashboard" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              id: "switchToTable",
              class: "btn btn-primary",
              type: "button",
              mix: [on("click", handle.props.onSwitchToTable)],
              children: "Switch to Table"
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: "20px", marginBottom: "20px" }, children: /* @__PURE__ */ jsx("div", { style: { flex: 1, display: "flex", gap: "16px" }, children: [
      /* @__PURE__ */ jsx(MetricCard, { id: 1, label: "Total Sales", value: "$125,430", change: "+12.5%" }),
      /* @__PURE__ */ jsx(MetricCard, { id: 2, label: "Orders", value: "1,234", change: "+8.2%" }),
      /* @__PURE__ */ jsx(MetricCard, { id: 3, label: "Customers", value: "5,678", change: "+15.3%" }),
      /* @__PURE__ */ jsx(MetricCard, { id: 4, label: "Revenue", value: "$89,123", change: "+9.7%" })
    ] }) }),
    /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "20px",
          marginBottom: "20px"
        },
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                padding: "20px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "8px"
              },
              children: [
                /* @__PURE__ */ jsx("h3", { style: { marginTop: 0, marginBottom: "16px" }, children: "Sales Performance" }),
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "space-around",
                      height: "200px",
                      padding: "20px 0"
                    },
                    children: chartData.map((value, index) => /* @__PURE__ */ jsx(ChartBar, { value, index }, index))
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                padding: "20px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "8px"
              },
              children: [
                /* @__PURE__ */ jsx("h3", { style: { marginTop: 0, marginBottom: "16px" }, children: "Recent Activity" }),
                /* @__PURE__ */ jsx(
                  "ul",
                  {
                    style: {
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      maxHeight: "200px",
                      overflowY: "auto"
                    },
                    children: activities.map((activity) => /* @__PURE__ */ jsx(ActivityItem, { ...activity }, activity.id))
                  }
                )
              ]
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx("div", { style: { marginBottom: "20px" }, children: [
      /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px"
          },
          children: [
            /* @__PURE__ */ jsx("div", { style: { display: "flex", alignItems: "center", gap: "12px" }, children: [
              /* @__PURE__ */ jsx("h3", { style: { margin: 0 }, children: "Dashboard Items" }),
              /* @__PURE__ */ jsx(
                "button",
                {
                  id: "sortDashboardAsc",
                  class: "btn btn-primary",
                  type: "button",
                  mix: [on("click", sortDashboardAsc)],
                  style: { padding: "4px 8px", fontSize: "12px" },
                  children: "Sort \u2191"
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  id: "sortDashboardDesc",
                  class: "btn btn-primary",
                  type: "button",
                  mix: [on("click", sortDashboardDesc)],
                  style: { padding: "4px 8px", fontSize: "12px" },
                  children: "Sort \u2193"
                }
              )
            ] }),
            /* @__PURE__ */ jsx(SearchInput, {})
          ]
        }
      ),
      /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            backgroundColor: "#fff",
            border: "1px solid #ddd",
            borderRadius: "8px",
            overflow: "hidden"
          },
          children: /* @__PURE__ */ jsx("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [
            /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsx("tr", { style: { backgroundColor: "#f5f5f5" }, children: [
              /* @__PURE__ */ jsx("th", { style: { padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }, children: "ID" }),
              /* @__PURE__ */ jsx("th", { style: { padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Label" }),
              /* @__PURE__ */ jsx("th", { style: { padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Status" }),
              /* @__PURE__ */ jsx("th", { style: { padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Value" }),
              /* @__PURE__ */ jsx("th", { style: { padding: "12px", textAlign: "left", borderBottom: "2px solid #ddd" }, children: "Actions" })
            ] }) }),
            /* @__PURE__ */ jsx("tbody", { children: dashboardRows.map((row) => /* @__PURE__ */ jsx(DashboardTableRow, { row }, row.id)) })
          ] })
        }
      )
    ] }),
    /* @__PURE__ */ jsx(FormWidgets, {})
  ] });
}
function App(handle) {
  let rows = [];
  let selected = null;
  let view = "table";
  let setRows = (newRows) => {
    rows = newRows;
    handle.update();
  };
  let setSelected = (newSelected) => {
    selected = newSelected;
    handle.update();
  };
  let switchToDashboard = () => {
    view = "dashboard";
    handle.update();
  };
  let switchToTable = () => {
    view = "table";
    handle.update();
  };
  return () => {
    if (view === "dashboard") {
      return /* @__PURE__ */ jsx(Dashboard, { onSwitchToTable: switchToTable });
    }
    return /* @__PURE__ */ jsx("div", { class: "container", children: [
      /* @__PURE__ */ jsx("div", { class: "jumbotron", children: /* @__PURE__ */ jsx("div", { class: "row", children: [
        /* @__PURE__ */ jsx("div", { class: "col-md-6", children: /* @__PURE__ */ jsx("h1", { children: "Remix" }) }),
        /* @__PURE__ */ jsx("div", { class: "col-md-6", children: /* @__PURE__ */ jsx("div", { class: "row", children: [
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "run",
              text: "Create 1,000 rows",
              fn: () => {
                rows = get1000Rows();
                selected = null;
                handle.update();
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "runlots",
              text: "Create 10,000 rows",
              fn: () => {
                rows = get10000Rows();
                selected = null;
                handle.update();
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "add",
              text: "Append 1,000 rows",
              fn: () => {
                setRows([...rows, ...get1000Rows()]);
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "update",
              text: "Update every 10th row",
              fn: () => {
                setRows(updatedEvery10thRow(rows));
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "clear",
              text: "Clear",
              fn: () => {
                rows = [];
                selected = null;
                handle.update();
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "swaprows",
              text: "Swap Rows",
              fn: () => {
                setRows(swapRows(rows));
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "sortasc",
              text: "Sort Ascending",
              fn: () => {
                setRows(sortRows(rows, true));
              }
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              id: "sortdesc",
              text: "Sort Descending",
              fn: () => {
                setRows(sortRows(rows, false));
              }
            }
          ),
          /* @__PURE__ */ jsx(Button, { id: "switchToDashboard", text: "Switch to Dashboard", fn: switchToDashboard })
        ] }) })
      ] }) }),
      /* @__PURE__ */ jsx("table", { class: "table table-hover table-striped test-data", children: /* @__PURE__ */ jsx("tbody", { children: rows.map((row) => {
        let rowId = row.id;
        return /* @__PURE__ */ jsx("tr", { class: selected === rowId ? "danger" : "", children: [
          /* @__PURE__ */ jsx("td", { class: "col-md-1", children: rowId }),
          /* @__PURE__ */ jsx("td", { class: "col-md-4", children: /* @__PURE__ */ jsx(
            "a",
            {
              mix: [
                on("click", () => {
                  setSelected(rowId);
                })
              ],
              children: row.label
            }
          ) }),
          /* @__PURE__ */ jsx("td", { class: "col-md-1", children: /* @__PURE__ */ jsx(
            "a",
            {
              mix: [
                on("click", () => {
                  setRows(remove(rows, rowId));
                })
              ],
              children: /* @__PURE__ */ jsx("span", { class: "glyphicon glyphicon-remove", "aria-hidden": "true" })
            }
          ) }),
          /* @__PURE__ */ jsx("td", { class: "col-md-6" })
        ] }, rowId);
      }) }) }),
      /* @__PURE__ */ jsx("span", { class: "preloadicon glyphicon glyphicon-remove", "aria-hidden": "true" })
    ] });
  };
}
var el = document.getElementById("app");
var root = createRoot(el);
root.render(/* @__PURE__ */ jsx(App, {}));
export {
  name
};
