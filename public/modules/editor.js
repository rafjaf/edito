// public/modules/editor.js
import { state } from './state.js';
import { elements } from './elements.js';
import { TOC_CLICK_OFFSET } from './config.js';

const LS_LEGAL_NUMBERING = 'edito-legal-numbering';

let livePreviewActive    = true;
let legalNumberingActive = localStorage.getItem(LS_LEGAL_NUMBERING) === 'true';
let legalBtn             = null;
// Store CodeMirror line *handles* so they survive edits/undos
let activeParaHandles    = [];
let headingUpdateTimeout = null;

const HEADING_LEVELS = ['lp-heading-1','lp-heading-2','lp-heading-3','lp-heading-4','lp-heading-5','lp-heading-6'];
const HEADING_RX = /^(#{1,6})\s/;
const BLOCK_BOUNDARY_RX = /^(\s{0,3}(#{1,6}\s|([-*_])(\s*\3){2,}\s*$|```|~~~|>\s?|[*+-]\s+(?:\[[ x]\]\s+)?|\d+[.)]\s+)|\s*\|.*\|\s*$)/i;
const INLINE_LINK_RX = /!?\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
const LINK_TOOLTIP = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
    ? 'Cmd-click to open link in a new tab'
    : 'Ctrl-click to open link in a new tab';

// ── Paragraph tracking ────────────────────────────────────────────────
function findMarkdownBlockBounds(cm, lineNo) {
    const last = cm.lastLine();
    const line = cm.getLine(lineNo);

    if (!line || line.trim() === '' || BLOCK_BOUNDARY_RX.test(line)) {
        return { start: lineNo, end: lineNo };
    }

    let start = lineNo, end = lineNo;
    while (start > 0) {
        const previous = cm.getLine(start - 1);
        if (!previous || previous.trim() === '' || BLOCK_BOUNDARY_RX.test(previous)) break;
        start--;
    }
    while (end < last) {
        const next = cm.getLine(end + 1);
        if (!next || next.trim() === '' || BLOCK_BOUNDARY_RX.test(next)) break;
        end++;
    }
    return { start, end };
}

function updateActiveParagraph(cm) {
    cm.operation(() => {
        // Remove class from previously active lines (use handles — stale handles are ignored by CM)
        activeParaHandles.forEach(h => cm.removeLineClass(h, 'wrap', 'lp-active-para'));
        activeParaHandles = [];
        if (!livePreviewActive) return;
        const activeLineHandles = new Set();
        cm.listSelections().forEach((selection) => {
            const firstLine = selection.from().line;
            const lastLine = selection.to().line;
            const seenLines = new Set();
            for (let selectedLine = firstLine; selectedLine <= lastLine; selectedLine++) {
                if (seenLines.has(selectedLine)) continue;
                const { start, end } = findMarkdownBlockBounds(cm, selectedLine);
                for (let l = start; l <= end; l++) {
                    seenLines.add(l);
                    const handle = cm.getLineHandle(l);
                    if (handle) activeLineHandles.add(handle);
                }
            }
        });
        activeLineHandles.forEach((handle) => {
            cm.addLineClass(handle, 'wrap', 'lp-active-para');
            activeParaHandles.push(handle);
        });
    });
}

// ── Heading line classes (drive CSS counters for legal numbering) ─────
function updateHeadingClasses(cm) {
    cm.operation(() => {
        const n = cm.lineCount();
        for (let i = 0; i < n; i++) {
            const h = cm.getLineHandle(i);
            if (!h) continue;
            HEADING_LEVELS.forEach(cls => cm.removeLineClass(h, 'wrap', cls));
            const m = HEADING_RX.exec(cm.getLine(i));
            if (m) cm.addLineClass(h, 'wrap', `lp-heading-${m[1].length}`);
        }
    });
}

function scheduleHeadingUpdate(cm) {
    if (!legalNumberingActive) return;
    clearTimeout(headingUpdateTimeout);
    headingUpdateTimeout = setTimeout(() => updateHeadingClasses(cm), 300);
}

// ── Live preview links ────────────────────────────────────────────────
function getInlineLinkAt(cm, pos) {
    const line = cm.getLine(pos.line);
    if (!line) return null;

    INLINE_LINK_RX.lastIndex = 0;
    let match;
    while ((match = INLINE_LINK_RX.exec(line))) {
        const markerOffset = match[0].startsWith('!') ? 1 : 0;
        const textStart = match.index + markerOffset + 1;
        const textEnd = textStart + match[1].length;
        if (pos.ch >= textStart && pos.ch <= textEnd) {
            return { text: match[1], href: normalizeLinkTarget(match[2]) };
        }
    }
    return null;
}

function getInlineLinkByText(cm, lineNo, text) {
    const line = cm.getLine(lineNo);
    if (!line || !text) return null;

    INLINE_LINK_RX.lastIndex = 0;
    const matches = [];
    let match;
    while ((match = INLINE_LINK_RX.exec(line))) {
        if (match[1] === text) matches.push({ text: match[1], href: normalizeLinkTarget(match[2]) });
    }
    return matches.length === 1 ? matches[0] : null;
}

function normalizeLinkTarget(rawHref) {
    const href = rawHref.trim();
    if (href.startsWith('#xml=')) return href.slice(5);
    if (href.startsWith('xml=')) return href.slice(4);
    try {
        return new URL(href, window.location.href).href;
    } catch {
        return href;
    }
}

function getMouseLink(cm, event) {
    if (!(event.target instanceof Element)) return null;
    const target = event.target.closest('.cm-link:not(.cm-formatting)');
    if (!target) return null;
    const pos = cm.coordsChar({ left: event.clientX, top: event.clientY }, 'client');
    return getInlineLinkAt(cm, pos) || getInlineLinkByText(cm, pos.line, target.textContent);
}

function initLivePreviewLinks(cm) {
    const wrapper = cm.getWrapperElement();

    cm.on('mousemove', (_cm, event) => {
        const link = getMouseLink(cm, event);
        wrapper.title = link ? LINK_TOOLTIP : '';
        if (event.target instanceof Element) event.target.title = link ? LINK_TOOLTIP : '';
        wrapper.classList.toggle('lp-link-hover', Boolean(link));
    });

    cm.on('mouseout', () => {
        wrapper.title = '';
        wrapper.classList.remove('lp-link-hover');
    });

    cm.on('mousedown', (_cm, event) => {
        if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return;
        const link = getMouseLink(cm, event);
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        window.open(link.href, '_blank', 'noopener');
    });
}

// ── Live preview ──────────────────────────────────────────────────────
function enableLivePreview() {
    livePreviewActive = true;
    const pane = elements.editorPane;
    pane.classList.add('lp-mode');
    if (state.easymde) updateActiveParagraph(state.easymde.codemirror);
}

// ── Legal numbering toggle ────────────────────────────────────────────
function setLegalNumbering(active) {
    legalNumberingActive = active;
    localStorage.setItem(LS_LEGAL_NUMBERING, String(active));
    const cm = state.easymde?.codemirror;
    if (active) {
        document.body.classList.add('legal-numbering');
        if (cm) updateHeadingClasses(cm);
        if (legalBtn) { legalBtn.classList.add('active'); legalBtn.title = 'Remove Legal Numbering'; }
    } else {
        document.body.classList.remove('legal-numbering');
        if (cm) {
            cm.operation(() => {
                for (let i = 0; i < cm.lineCount(); i++) {
                    const h = cm.getLineHandle(i);
                    if (h) HEADING_LEVELS.forEach(cls => cm.removeLineClass(h, 'wrap', cls));
                }
            });
        }
        if (legalBtn) { legalBtn.classList.remove('active'); legalBtn.title = 'Legal Numbering'; }
    }
}

// ── Public API ────────────────────────────────────────────────────────
export function buildScrollMap() { state.scrollMap = []; }

export function refreshState() {
    if (!state.easymde) return;
    const cm = state.easymde.codemirror;
    enableLivePreview();
    if (legalNumberingActive) updateHeadingClasses(cm);
    updateActiveParagraph(cm);
}

export function initEditor(onChangeCallback) {
    const legalNumberingToolbarBtn = {
        name: 'legal-numbering',
        action: () => setLegalNumbering(!legalNumberingActive),
        className: 'fa fa-list-ol',
        title: legalNumberingActive ? 'Remove Legal Numbering' : 'Legal Numbering',
    };

    state.easymde = new EasyMDE({
        element: document.getElementById('editor'),
        initialValue: '<!-- Select or create a file to begin -->',
        spellChecker: false,
        placeholder: 'Start writing your markdown...',
        status: false,
        maxHeight: '100%',
        sideBySideFullscreen: false,
        syncSideBySide: false,
        parsingConfig: { highlightFormatting: true },
        shortcuts: {
            togglePreview: null,
            toggleSideBySide: null,
            toggleFullScreen: null,
        },
        toolbar: [
            'bold', 'italic', 'heading', '|',
            'quote', 'unordered-list', 'ordered-list', '|',
            'link', 'image', 'table', '|',
            legalNumberingToolbarBtn, '|',
            'guide'
        ],
        codemirror: { indentUnit: 4, indentWithTabs: false, tabSize: 4 }
    });

    const cm = state.easymde.codemirror;
    enableLivePreview();
    initLivePreviewLinks(cm);

    // Apply persisted state once the toolbar DOM exists
    setTimeout(() => {
        legalBtn = elements.editorPane.querySelector('button.legal-numbering');
        if (legalNumberingActive) setLegalNumbering(true);
    }, 0);

    cm.on('cursorActivity', () => updateActiveParagraph(cm));
    cm.on('change', () => {
        scheduleHeadingUpdate(cm);
        onChangeCallback(state.easymde.value());
    });

    return state.easymde;
}

export function handleTocClick(e) {
    e.preventDefault();
    const a    = e.currentTarget;
    const line = Number(a.dataset.line);
    const cm   = state.easymde.codemirror;
    cm.setCursor({ line, ch: 0 });
    cm.getInputField().focus({ preventScroll: true });
    const scroller = cm.getScrollerElement();
    scroller.scrollTop = Math.max(0, cm.charCoords({ line, ch: 0 }, 'local').top - TOC_CLICK_OFFSET);
    elements.editorPane.scrollTop = 0;
}
