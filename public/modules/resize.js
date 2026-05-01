// public/modules/resize.js
// Resizable sidebars with localStorage persistence

const LS_LEFT  = 'edito-pane-left-width';
const LS_RIGHT = 'edito-pane-right-width';

const MIN_SIDEBAR = 120; // px
const MIN_EDITOR  = 200; // px

export function initResizablePanes() {
    const container   = document.getElementById('main-container');
    const filePane    = document.getElementById('file-pane');
    const editorPane  = document.getElementById('editor-pane');
    const outlinePane = document.getElementById('outline-pane');
    const handleLeft  = document.getElementById('resize-left');
    const handleRight = document.getElementById('resize-right');

    // Restore saved widths
    const savedLeft  = localStorage.getItem(LS_LEFT);
    const savedRight = localStorage.getItem(LS_RIGHT);
    if (savedLeft)  filePane.style.width    = savedLeft;
    if (savedRight) outlinePane.style.width = savedRight;

    function startDrag(e, side) {
        e.preventDefault();
        const startX = e.clientX;
        const startLeftW  = filePane.offsetWidth;
        const startRightW = outlinePane.offsetWidth;
        const totalW      = container.offsetWidth;

        function onMove(ev) {
            const dx = ev.clientX - startX;
            const containerW = container.offsetWidth;

            if (side === 'left') {
                let newLeft = Math.max(MIN_SIDEBAR, startLeftW + dx);
                // Ensure editor keeps minimum width
                const maxLeft = containerW - startRightW - MIN_EDITOR - 8; // 8 = two handle widths
                newLeft = Math.min(newLeft, maxLeft);
                filePane.style.width = newLeft + 'px';
                localStorage.setItem(LS_LEFT, newLeft + 'px');
            } else {
                let newRight = Math.max(MIN_SIDEBAR, startRightW - dx);
                const maxRight = containerW - startLeftW - MIN_EDITOR - 8;
                newRight = Math.min(newRight, maxRight);
                outlinePane.style.width = newRight + 'px';
                localStorage.setItem(LS_RIGHT, newRight + 'px');
            }
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            // Refresh CodeMirror after resize
            if (window._editorInstance) window._editorInstance.codemirror.refresh();
        }

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    handleLeft.addEventListener('mousedown',  e => startDrag(e, 'left'));
    handleRight.addEventListener('mousedown', e => startDrag(e, 'right'));
}
