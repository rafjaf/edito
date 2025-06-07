// public/modules/editor.js
import { state } from './state.js';
import { elements } from './elements.js';
import { TOC_CLICK_OFFSET } from './config.js';

let scrollSyncTimeout = null;

function buildScrollMap(content) {
    requestAnimationFrame(() => {
        if (!state.easymde.isPreviewActive()) {
            state.scrollMap = [];
            return;
        }
        const preview = elements.editorPane.querySelector('.editor-preview-side, .editor-preview');
        if (!preview) {
            state.scrollMap = [];
            return;
        }
        const sourceHeadings = [];
        const headingRx = /^(#{1,6})\s+(.*)$/gm;
        let match;
        while ((match = headingRx.exec(content)) !== null) {
            sourceHeadings.push({ line: (content.slice(0, match.index).match(/\n/g) || []).length });
        }
        const headingsInPreview = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const newLinkedMap = [];
        const limit = Math.min(sourceHeadings.length, headingsInPreview.length);
        for (let i = 0; i < limit; i++) {
            newLinkedMap.push({ line: sourceHeadings[i].line, offset: headingsInPreview[i].offsetTop });
        }
        state.scrollMap = newLinkedMap;
    });
}

function syncPreviewScroll() {
    if (!state.easymde.isSideBySideActive() || state.scrollMap.length < 1) return;
    const cm = state.easymde.codemirror;
    const preview = elements.editorPane.querySelector('.editor-preview-side');
    if (!preview) return;

    const scrollInfo = cm.getScrollInfo();
    const editorTopLine = cm.lineAtHeight(scrollInfo.top, 'local');
    let currentEntry = null, nextEntry = null;
    for (const entry of state.scrollMap) {
        if (entry.line > editorTopLine) { nextEntry = entry; break; }
        currentEntry = entry;
    }
    if (!currentEntry) { preview.scrollTop = 0; return; }

    let targetScrollTop = currentEntry.offset;
    if (nextEntry) {
        const linesBetween = nextEntry.line - currentEntry.line;
        const linesScrolled = editorTopLine - currentEntry.line;
        const scrollPercentage = linesBetween > 0 ? (linesScrolled / linesBetween) : 0;
        const pixelsBetween = nextEntry.offset - currentEntry.offset;
        targetScrollTop += (pixelsBetween * scrollPercentage);
    }
    preview.scrollTop = targetScrollTop;
}

function blockBuiltInSideBySideSync() {
    const scroller = state.easymde.codemirror.getScrollerElement();
    if (scroller.__syncBlocked) return;
    const stop = e => e.stopImmediatePropagation();
    scroller.addEventListener('scroll', stop, true);
    elements.editorPane.addEventListener('scroll', stop, true);
    scroller.__syncBlocked = true;
}

export function initEditor(onChangeCallback) {
    state.easymde = new EasyMDE({
        element: document.getElementById('editor'),
        initialValue: '<!-- Select or create a file to begin -->',
        spellChecker: false,
        placeholder: 'Start writing your markdown...',
        status: false,
        maxHeight: '100%',
        sideBySideFullscreen: false,
        syncSideBySide: false,
        toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "table", "|", "preview", "side-by-side", "|", "guide"],
        codemirror: { indentUnit: 4, indentWithTabs: false, tabSize: 4 }
    });

    const editorScroller = state.easymde.codemirror.getScrollerElement();
    editorScroller.addEventListener('scroll', () => {
        clearTimeout(scrollSyncTimeout);
        scrollSyncTimeout = setTimeout(syncPreviewScroll, 50);
    });

    blockBuiltInSideBySideSync();

    const observer = new MutationObserver(() => {
        const sideBySideButton = elements.editorPane.querySelector('button[title^="Toggle Side by Side"]');
        if (sideBySideButton) {
            observer.disconnect();
            sideBySideButton.addEventListener('click', () => {
                setTimeout(() => {
                    const editorWrapper = elements.editorPane.querySelector('.CodeMirror-wrap');
                    const preview = elements.editorPane.querySelector('.editor-preview-side');
                    if (editorWrapper && preview) preview.style.height = `${editorWrapper.offsetHeight}px`;
                    state.easymde.codemirror.refresh();
                    buildScrollMap(state.easymde.value());
                }, 50);
            });
        }
    });
    observer.observe(elements.editorPane, { childList: true, subtree: true });

    state.easymde.codemirror.on('change', () => onChangeCallback(state.easymde.value()));

    return state.easymde;
}

export function handleTocClick(e) {
    e.preventDefault();
    const a = e.currentTarget;
    const line = Number(a.dataset.line);
    const levelTxt = a.dataset.lvl;
    const headingTxt = a.dataset.txt;
    const cm = state.easymde.codemirror;

    cm.setCursor({ line, ch: 0 });
    cm.getInputField().focus({ preventScroll: true });
    const scroller = cm.getScrollerElement();
    scroller.scrollTop = Math.max(0, cm.charCoords({ line, ch: 0 }, 'local').top - TOC_CLICK_OFFSET);
    elements.editorPane.scrollTop = 0;

    if (state.easymde.isSideBySideActive() || state.easymde.isPreviewActive()) {
        requestAnimationFrame(() => {
            const previewSel = state.easymde.isSideBySideActive() ? '.editor-preview-side' : '.editor-preview';
            const preview = elements.editorPane.querySelector(previewSel);
            if (!preview) return;
            const headings = preview.querySelectorAll(`h${levelTxt}`);
            const target = Array.from(headings).find(h => h.textContent.trim() === headingTxt);
            if (target) {
                if (state.easymde.isSideBySideActive()) {
                    preview.scrollTop = Math.max(0, target.offsetTop - TOC_CLICK_OFFSET);
                } else {
                    target.scrollIntoView({ block: 'start' });
                    window.scrollBy(0, -TOC_CLICK_OFFSET);
                }
            }
        });
    }
}

export { buildScrollMap };