// public/modules/editor.js
import { state } from './state.js';
import { elements } from './elements.js';
import { TOC_CLICK_OFFSET } from './config.js';

const LS_LIVE_PREVIEW    = 'edito-live-preview';
const LS_LEGAL_NUMBERING = 'edito-legal-numbering';

let livePreviewActive    = localStorage.getItem(LS_LIVE_PREVIEW) === 'true';
let legalNumberingActive = localStorage.getItem(LS_LEGAL_NUMBERING) === 'true';
let livePreviewBtn       = null;
let legalBtn             = null;
let activeParagraphLines = [];
let headingUpdateTimeout = null;

const HEADING_LEVELS = ['lp-heading-1','lp-heading-2','lp-heading-3','lp-heading-4','lp-heading-5','lp-heading-6'];
const HEADING_RX = /^(#{1,6})\s/;

// ── Paragraph tracking ────────────────────────────────────────────────
function findParagraphBounds(cm, line) {
    const lineCount = cm.lineCount();
    let start = line, end = line;
    while (start > 0 && cm.getLine(start - 1).trim() !== '') start--;
    while (end < lineCount - 1 && cm.getLine(end + 1).trim() !== '') end++;
    return { start, end };
}

function updateActiveParagraph(cm) {
    activeParagraphLines.forEach(l => cm.removeLineClass(l, 'wrap', 'lp-active-para'));
    activeParagraphLines = [];
    if (!livePreviewActive) return;
    const sels   = cm.listSelections();
    const first  = sels[0].from().line;
    const last   = sels[sels.length - 1].to().line;
    const { start } = findParagraphBounds(cm, first);
    const { end }   = findParagraphBounds(cm, last);
    for (let l = start; l <= end; l++) {
        cm.addLineClass(l, 'wrap', 'lp-active-para');
        activeParagraphLines.push(l);
    }
}

// ── Heading line classes (drive CSS counters for legal numbering) ─────
function updateHeadingClasses(cm) {
    const n = cm.lineCount();
    for (let i = 0; i < n; i++) {
        HEADING_LEVELS.forEach(cls => cm.removeLineClass(i, 'wrap', cls));
        const m = HEADING_RX.exec(cm.getLine(i));
        if (m) cm.addLineClass(i, 'wrap', `lp-heading-${m[1].length}`);
    }
}

function scheduleHeadingUpdate(cm) {
    if (!legalNumberingActive) return;
    clearTimeout(headingUpdateTimeout);
    headingUpdateTimeout = setTimeout(() => updateHeadingClasses(cm), 300);
}

// ── Live preview toggle ───────────────────────────────────────────────
function setLivePreview(active) {
    livePreviewActive = active;
    localStorage.setItem(LS_LIVE_PREVIEW, active);
    const pane = elements.editorPane;
    if (active) {
        pane.classList.add('lp-mode');
        updateActiveParagraph(state.easymde.codemirror);
        if (livePreviewBtn) { livePreviewBtn.classList.add('active'); livePreviewBtn.title = 'Exit Live Preview'; }
    } else {
        pane.classList.remove('lp-mode');
        activeParagraphLines.forEach(l => state.easymde.codemirror.removeLineClass(l, 'wrap', 'lp-active-para'));
        activeParagraphLines = [];
        if (livePreviewBtn) { livePreviewBtn.classList.remove('active'); livePreviewBtn.title = 'Live Preview'; }
    }
    // Let CodeMirror recalculate line heights (headings change size)
    requestAnimationFrame(() => state.easymde.codemirror.refresh());
}

// ── Legal numbering toggle ────────────────────────────────────────────
function setLegalNumbering(active) {
    legalNumberingActive = active;
    localStorage.setItem(LS_LEGAL_NUMBERING, active);
    const cm = state.easymde?.codemirror;
    if (active) {
        document.body.classList.add('legal-numbering');
        if (cm) updateHeadingClasses(cm);
        if (legalBtn) { legalBtn.classList.add('active'); legalBtn.title = 'Remove Legal Numbering'; }
    } else {
        document.body.classList.remove('legal-numbering');
        // Remove heading classes — they are only needed for the CSS counters
        if (cm) {
            for (let i = 0; i < cm.lineCount(); i++)
                HEADING_LEVELS.forEach(cls => cm.removeLineClass(i, 'wrap', cls));
        }
        if (legalBtn) { legalBtn.classList.remove('active'); legalBtn.title = 'Legal Numbering'; }
    }
}

// ── Public API ────────────────────────────────────────────────────────
export function buildScrollMap() { state.scrollMap = []; }

// Called by main.js after a file is loaded or cleared
export function refreshState() {
    if (!state.easymde) return;
    const cm = state.easymde.codemirror;
    if (legalNumberingActive) updateHeadingClasses(cm);
    updateActiveParagraph(cm);
}

export function initEditor(onChangeCallback) {
    const livePreviewToolbarBtn = {
        name: 'live-preview',
        action: () => setLivePreview(!livePreviewActive),
        className: 'fa fa-eye',
        title: 'Live Preview',
    };
    const legalNumberingToolbarBtn = {
        name: 'legal-numbering',
        action: () => setLegalNumbering(!legalNumberingActive),
        className: 'fa fa-list-ol',
        title: 'Legal Numbering',
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
        toolbar: [
            'bold', 'italic', 'heading', '|',
            'quote', 'unordered-list', 'ordered-list', '|',
            'link', 'image', 'table', '|',
            livePreviewToolbarBtn, '|',
            legalNumberingToolbarBtn, '|',
            'guide'
        ],
        codemirror: { indentUnit: 4, indentWithTabs: false, tabSize: 4 }
    });

    const cm = state.easymde.codemirror;

    setTimeout(() => {
        livePreviewBtn = elements.editorPane.querySelector('.fa-eye')?.closest('button');
        legalBtn       = elements.editorPane.querySelector('.fa-list-ol')?.closest('button');
        if (livePreviewActive)    setLivePreview(true);
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
    const a  = e.currentTarget;
    const line = Number(a.dataset.line);
    const cm = state.easymde.codemirror;
    cm.setCursor({ line, ch: 0 });
    cm.getInputField().focus({ preventScroll: true });
    const scroller = cm.getScrollerElement();
    scroller.scrollTop = Math.max(0, cm.charCoords({ line, ch: 0 }, 'local').top - TOC_CLICK_OFFSET);
    elements.editorPane.scrollTop = 0;
}
