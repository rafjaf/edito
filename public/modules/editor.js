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
let listMarkerHandles    = [];
let headingNumberByLine  = new Map();
let headingUpdateTimeout = null;
let revealActiveSource   = false;
let lastClickedHref      = null;
let measurementRefreshFrame = null;
let preserveRevealOnToolbarAction = false;

const HEADING_LEVELS = ['lp-heading-1','lp-heading-2','lp-heading-3','lp-heading-4','lp-heading-5','lp-heading-6'];
const HEADING_RX = /^(#{1,6})\s/;
const EMPTY_HEADING_RX = /^\s{0,3}#{1,6}\s*$/;
const LIST_MARKER_RX = /^(\t*)-\s+/;
const BLOCK_BOUNDARY_RX = /^(\s{0,3}(#{1,6}\s|([-*_])(\s*\3){2,}\s*$|```|~~~|>\s?|[*+-]\s+(?:\[[ x]\]\s+)?|\d+[.)]\s+)|\s*\|.*\|\s*$)/i;
const INLINE_LINK_RX = /!?\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

function scheduleMeasurementRefresh(cm) {
    if (measurementRefreshFrame !== null) return;
    measurementRefreshFrame = requestAnimationFrame(() => {
        measurementRefreshFrame = null;
        cm.refresh();
    });
}

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
        const previousHandles = activeParaHandles;
        if (!livePreviewActive || !revealActiveSource) {
            if (previousHandles.length) {
                previousHandles.forEach(h => cm.removeLineClass(h, 'wrap', 'lp-active-para'));
                activeParaHandles = [];
                scheduleMeasurementRefresh(cm);
            }
            return;
        }
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

        const nextHandles = Array.from(activeLineHandles);
        const unchanged = previousHandles.length === nextHandles.length
            && previousHandles.every((handle, index) => handle === nextHandles[index]);
        if (unchanged) return;

        // Remove class from previously active lines (use handles — stale handles are ignored by CM)
        previousHandles.forEach(h => cm.removeLineClass(h, 'wrap', 'lp-active-para'));
        activeParaHandles = [];
        nextHandles.forEach((handle) => {
            cm.addLineClass(handle, 'wrap', 'lp-active-para');
            activeParaHandles.push(handle);
        });
        scheduleMeasurementRefresh(cm);
    });
}

// ── Heading line classes (drive CSS counters for legal numbering) ─────
function updateHeadingClasses(cm) {
    cm.operation(() => {
        const n = cm.lineCount();
        const counters = [0, 0, 0, 0, 0, 0];
        headingNumberByLine = new Map();
        for (let i = 0; i < n; i++) {
            const h = cm.getLineHandle(i);
            if (!h) continue;
            HEADING_LEVELS.forEach(cls => cm.removeLineClass(h, 'wrap', cls));
            cm.removeLineClass(h, 'wrap', 'lp-empty-heading');
            const line = cm.getLine(i);
            const m = HEADING_RX.exec(line);
            if (m) {
                const level = m[1].length;
                counters[level - 1]++;
                for (let j = level; j < counters.length; j++) counters[j] = 0;
                headingNumberByLine.set(i, `${counters.slice(0, level).join('.')}. `);
                cm.addLineClass(h, 'wrap', `lp-heading-${level}`);
                cm.addLineClass(h, 'wrap', 'lp-heading-numbered');
                if (line.slice(m[0].length).trim() === '') cm.addLineClass(h, 'wrap', 'lp-empty-heading');
            } else {
                cm.removeLineClass(h, 'wrap', 'lp-heading-numbered');
                if (EMPTY_HEADING_RX.test(line)) cm.addLineClass(h, 'wrap', 'lp-empty-heading');
            }
        }
        applyHeadingNumbersToVisibleLines(cm);
    });
}

function scheduleHeadingUpdate(cm) {
    clearTimeout(headingUpdateTimeout);
    headingUpdateTimeout = setTimeout(() => updateHeadingClasses(cm), 300);
}

function applyHeadingNumberToLine(cm, lineOrNumber, element) {
    const lineNo = typeof lineOrNumber === 'number' ? lineOrNumber : cm.getLineNumber(lineOrNumber);
    const number = headingNumberByLine.get(lineNo);
    if (!number) {
        element.style.removeProperty('--lp-heading-number');
        return;
    }
    element.style.setProperty('--lp-heading-number', JSON.stringify(number));
}

function applyHeadingNumbersToVisibleLines(cm) {
    const viewport = cm.getViewport();
    for (let lineNo = viewport.from; lineNo < viewport.to; lineNo++) {
        const lineInfo = cm.lineInfo(lineNo);
        if (lineInfo?.handle) {
            const lineNode = document.querySelector(`.CodeMirror-code > div:nth-child(${lineNo - viewport.from + 1}) pre`);
            if (lineNode) applyHeadingNumberToLine(cm, lineNo, lineNode);
        }
    }
}

// ── List markers ─────────────────────────────────────────────────────
function updateListMarkers(cm) {
    listMarkerHandles.forEach(marker => marker.clear());
    listMarkerHandles = [];

    cm.operation(() => {
        for (let lineNo = 0; lineNo < cm.lineCount(); lineNo++) {
            const line = cm.getLine(lineNo);
            const match = LIST_MARKER_RX.exec(line);
            if (!match) continue;
            const from = { line: lineNo, ch: match[1].length };
            const to = { line: lineNo, ch: match[0].length };
            const depth = Math.min(match[1].length, 2);
            listMarkerHandles.push(cm.markText(from, to, { className: `lp-list-marker lp-list-marker-depth-${depth}` }));
        }
    });
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
    cm.on('mousedown', (_cm, event) => {
        if (event.button !== 0) return;
        revealActiveSource = true;
        const link = getMouseLink(cm, event);
        if (!link) {
            lastClickedHref = null;
            updateActiveParagraph(cm);
            return;
        }

        const shouldOpen = event.metaKey || event.ctrlKey || lastClickedHref === link.href;
        lastClickedHref = link.href;
        updateActiveParagraph(cm);
        if (shouldOpen) {
            event.preventDefault();
            event.stopPropagation();
            window.open(link.href, '_blank', 'noopener');
        }
    });
}

function toggleUnorderedList(editor) {
    const cm = editor.codemirror || editor;
    const ranges = cm.listSelections().map((selection) => {
        const from = selection.from();
        const to = selection.to();
        const endLine = to.ch === 0 && to.line > from.line ? to.line - 1 : to.line;
        return { start: from.line, end: endLine };
    });

    cm.operation(() => {
        ranges.forEach(({ start, end }) => {
            const lines = [];
            for (let lineNo = start; lineNo <= end; lineNo++) {
                const text = cm.getLine(lineNo);
                if (text.trim()) lines.push({ lineNo, text });
            }
            if (!lines.length) lines.push({ lineNo: start, text: cm.getLine(start) || '' });

            const removeBullets = lines.every(({ text }) => /^[\t ]*[-*+]\s+/.test(text));
            lines.forEach(({ lineNo, text }) => {
                if (removeBullets) {
                    const marker = /^[\t ]*[-*+]\s+/.exec(text);
                    const indentLength = /^[\t ]*/.exec(text)[0].length;
                    cm.replaceRange('', { line: lineNo, ch: indentLength }, { line: lineNo, ch: marker[0].length });
                    return;
                }
                if (/^[\t ]*[-*+]\s+/.test(text)) return;
                const indentLength = /^[\t ]*/.exec(text)[0].length;
                cm.replaceRange('- ', { line: lineNo, ch: indentLength });
            });
        });
    });

    revealActiveSource = true;
    updateActiveParagraph(cm);
    updateListMarkers(cm);
    cm.focus();
}

function markdownEscapeLinkText(text) {
    return text.replace(/\]/g, '\\]');
}

function normalizeMarkdownBlock(text) {
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

function htmlToMarkdown(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const renderChildren = (node, context = {}) => Array.from(node.childNodes)
        .map(child => renderNode(child, context))
        .join('');

    const renderList = (node, ordered, depth) => {
        let index = 1;
        const lines = Array.from(node.children)
            .filter(child => child.tagName?.toLowerCase() === 'li')
            .map((li) => {
                const nested = [];
                const content = Array.from(li.childNodes).map((child) => {
                    const tag = child.tagName?.toLowerCase();
                    if (tag === 'ul' || tag === 'ol') {
                        nested.push(renderList(child, tag === 'ol', depth + 1).trimEnd());
                        return '';
                    }
                    return renderNode(child, { inList: true });
                }).join('').trim();
                const marker = ordered ? `${index++}. ` : '- ';
                const current = `${'\t'.repeat(depth)}${marker}${content}`;
                return nested.length ? `${current}\n${nested.join('\n')}` : current;
            });
        return `${lines.join('\n')}\n\n`;
    };

    const renderNode = (node, context = {}) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.replace(/\s+/g, ' ');
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        if (tag === 'br') return '\n';
        if (tag === 'a') {
            const href = node.getAttribute('href');
            const text = renderChildren(node, context).trim() || href || '';
            return href ? `[${markdownEscapeLinkText(text)}](${href})` : text;
        }
        if (tag === 'strong' || tag === 'b') return `**${renderChildren(node, context).trim()}**`;
        if (tag === 'em' || tag === 'i') return `*${renderChildren(node, context).trim()}*`;
        if (tag === 'code') return `\`${renderChildren(node, context).trim()}\``;
        if (tag === 'pre') return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
        if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${renderChildren(node, context).trim()}\n\n`;
        if (tag === 'ul' || tag === 'ol') return renderList(node, tag === 'ol', context.listDepth || 0);
        if (tag === 'p') return `${renderChildren(node, context).trim()}\n\n`;
        if (tag === 'div' || tag === 'section' || tag === 'article') {
            const rendered = renderChildren(node, context).trim();
            return rendered ? `${rendered}\n\n` : '';
        }
        return renderChildren(node, context);
    };

    return normalizeMarkdownBlock(renderChildren(doc.body).trim());
}

function initHtmlPaste(cm) {
    cm.on('paste', (_cm, event) => {
        const html = event.clipboardData?.getData('text/html');
        if (!html) return;
        const markdown = htmlToMarkdown(html);
        if (!markdown) return;
        event.preventDefault();
        revealActiveSource = true;
        cm.replaceSelection(markdown, 'around');
        updateActiveParagraph(cm);
    });
}

function initToolbarEditingMode(cm) {
    const toolbar = elements.editorPane.querySelector('.editor-toolbar');
    if (!toolbar) return;

    toolbar.addEventListener('mousedown', () => {
        preserveRevealOnToolbarAction = true;
        revealActiveSource = true;
        updateActiveParagraph(cm);
    });

    toolbar.addEventListener('click', () => {
        setTimeout(() => {
            preserveRevealOnToolbarAction = false;
            revealActiveSource = true;
            updateHeadingClasses(cm);
            updateActiveParagraph(cm);
            scheduleMeasurementRefresh(cm);
        }, 0);
    });
}

// ── Live preview ──────────────────────────────────────────────────────
function enableLivePreview({ revealSource = false } = {}) {
    livePreviewActive = true;
    revealActiveSource = revealSource;
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
                    if (h) {
                        HEADING_LEVELS.forEach(cls => cm.removeLineClass(h, 'wrap', cls));
                        cm.removeLineClass(h, 'wrap', 'lp-heading-numbered');
                    }
                }
            });
            headingNumberByLine = new Map();
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
    updateHeadingClasses(cm);
    updateListMarkers(cm);
    updateActiveParagraph(cm);
}

export function initEditor(onChangeCallback) {
    const legalNumberingToolbarBtn = {
        name: 'legal-numbering',
        action: () => setLegalNumbering(!legalNumberingActive),
        className: 'fa fa-list-ol',
        title: legalNumberingActive ? 'Remove Legal Numbering' : 'Legal Numbering',
    };
    const unorderedListToolbarBtn = {
        name: 'unordered-list',
        action: toggleUnorderedList,
        className: 'fa fa-list-ul',
        title: 'Generic List',
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
            'quote', unorderedListToolbarBtn, 'ordered-list', '|',
            'link', 'image', 'table', '|',
            legalNumberingToolbarBtn, '|',
            'guide'
        ],
        codemirror: { indentUnit: 4, indentWithTabs: true, tabSize: 4 }
    });

    const cm = state.easymde.codemirror;
    enableLivePreview();
    initLivePreviewLinks(cm);
    initHtmlPaste(cm);

    // Apply persisted state once the toolbar DOM exists
    setTimeout(() => {
        legalBtn = elements.editorPane.querySelector('button.legal-numbering');
        initToolbarEditingMode(cm);
        if (legalNumberingActive) setLegalNumbering(true);
    }, 0);

    cm.on('cursorActivity', () => updateActiveParagraph(cm));
    cm.on('keydown', () => {
        revealActiveSource = true;
        updateActiveParagraph(cm);
    });
    cm.on('blur', () => {
        if (preserveRevealOnToolbarAction) return;
        revealActiveSource = false;
        lastClickedHref = null;
        updateActiveParagraph(cm);
    });
    cm.on('renderLine', (_cm, line, element) => applyHeadingNumberToLine(cm, line, element));
    cm.on('viewportChange', () => {
        if (legalNumberingActive) applyHeadingNumbersToVisibleLines(cm);
    });
    cm.on('change', () => {
        scheduleHeadingUpdate(cm);
        updateListMarkers(cm);
        onChangeCallback(state.easymde.value());
    });

    return state.easymde;
}

export function handleTocClick(e) {
    e.preventDefault();
    const a    = e.currentTarget;
    const line = Number(a.dataset.line);
    const cm   = state.easymde.codemirror;
    revealActiveSource = false;
    lastClickedHref = null;
    cm.setCursor({ line, ch: 0 });
    cm.getInputField().focus({ preventScroll: true });
    updateActiveParagraph(cm);
    const scroller = cm.getScrollerElement();
    scroller.scrollTop = Math.max(0, cm.charCoords({ line, ch: 0 }, 'local').top - TOC_CLICK_OFFSET);
    elements.editorPane.scrollTop = 0;
}
