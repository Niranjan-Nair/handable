// The page as an editor: the main text and the text boxes put on it. Each is a region
// with its own hidden field (so each keeps its own undo); a click goes to the region
// under it, and the toolbar works on the region being edited. A text box is added
// with the toolbar's button and a click where it goes, moved and widened by its
// handles, and dropped when it's left empty.
import { $, $$, clamp, status } from '../dom.js';
import { saveSettings, settings, uid } from '../store.js';
import { posAt } from './caret.js';
import { createEditor } from './editor.js';
import { boxFrame, drawOverlay } from './overlay.js';
import { createToolbar } from './toolbar.js';

export const SIZE_MIN = 12;
export const SIZE_MAX = 160;

// getResult(): the result of generate() on show; regenerate(): write the page again
// now; textChanged(): soon (as typing does)
export function createPage({ getResult, regenerate, textChanged }) {
    const wrap = $('.page-editor');
    const mainTa = $('#g-text');
    const editors = new Map(); // region id ('main' or a text box's id) -> its editor
    let active = 'main';
    let placing = false; // the next click on a page puts a text box there
    let pressed = false; // a mouse selection is being made
    let drag = null; // a text box being moved or widened

    const boxes = () => settings.gen.boxes;
    const boxById = (id) => boxes().find((b) => b.id === id);
    const cur = () => editors.get(active) || editors.get('main');
    const res = () => getResult();

    function editorFor(ta, map) {
        return createEditor({ ta, map, redraw: draw, regenerate, toolbar: () => toolbar });
    }

    editors.set(
        'main',
        editorFor(mainTa, () => (res() && res().caretMap) || null),
    );

    // a text box's region: its own hidden field, kept in step with the box's text
    function addRegion(b) {
        const ta = document.createElement('textarea');
        ta.className = 'ghost-input';
        ta.spellcheck = false;
        ta.autocomplete = 'off';
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('aria-label', 'Text box. It appears on the page in your handwriting.');
        ta.value = b.text;
        wrap.appendChild(ta);

        ta.addEventListener('input', () => {
            const box = boxById(b.id);
            if (!box) return;

            box.text = ta.value;
            saveSettings();
            textChanged();
        });

        editors.set(
            b.id,
            editorFor(ta, () => (res() && res().caretMap.boxes[b.id]) || null),
        );
    }

    boxes().forEach(addRegion);

    // the toolbar works on whichever region is being edited
    const ed = {
        get ta() {
            return cur().ta;
        },
        text: () => cur().text(),
        apply: (c) => cur().apply(c),
        changed: () => cur().changed(),
        formats: () => cur().formats(),
        toggleFormat: (...a) => cur().toggleFormat(...a),
        size: () => (active === 'main' ? settings.gen.size : boxById(active).size),
        setSize,
    };

    const toolbar = createToolbar(ed);

    function setSize(v) {
        v = clamp(Math.round(v), SIZE_MIN, SIZE_MAX);

        if (active === 'main') {
            // through the panel's slider, which saves it and writes the page again
            const el = $('#g-size');
            el.value = v;
            el.dispatchEvent(new Event('input'));
        } else {
            boxById(active).size = v;
            saveSettings();
            regenerate();
        }
    }

    // edit region id, leaving the one being edited (a text box left empty goes)
    function activate(id) {
        if (id === active) return;

        const prev = boxById(active);
        active = id;
        if (prev && !prev.text) removeBox(prev.id);
    }

    function removeBox(id) {
        const i = boxes().findIndex((b) => b.id === id);
        if (i < 0) return;

        boxes().splice(i, 1);
        editors.get(id).ta.remove();
        editors.delete(id);
        if (active === id) active = 'main';
        saveSettings();
        regenerate();
    }

    function draw() {
        toolbar.draw();
        drawOverlay(res(), mainTa, cur(), active === 'main' ? null : active);
    }

    // ---- the pointer, in page px: { page, x, y, sheet }, or null off the pages
    function spotAt(e) {
        const sh = e.target.closest && e.target.closest('#g-preview .sheet');
        const r = res();
        if (!sh || !r) return null;

        const page = $$('#g-preview .sheet').indexOf(sh);
        const rect = sh.getBoundingClientRect();
        let x = ((e.clientX - rect.left) / rect.width) * r.width;
        let y = ((e.clientY - rect.top) / rect.height) * r.height;
        // undo the scan's tilt
        const sk = ((r.caretMap.skews[page] || 0) * Math.PI) / 180;

        if (sk) {
            const dx = x - r.width / 2;
            const dy = y - r.height / 2;
            x = r.width / 2 + dx * Math.cos(sk) + dy * Math.sin(sk);
            y = r.height / 2 - dx * Math.sin(sk) + dy * Math.cos(sk);
        }

        return { page, x, y, scale: r.width / rect.width };
    }

    // the text box under a spot (the one put on last, where they overlap)
    function boxAt(s) {
        const r = res();

        for (const b of [...r.boxes].reverse()) {
            const f = boxFrame(r, b);
            if (f.page === s.page && s.x >= f.x0 && s.x <= f.x1 && s.y >= f.y0 && s.y <= f.y1) return b.id;
        }

        return null;
    }

    // the caret position under the pointer in the region being edited
    function posUnder(e, enterMath) {
        const s = spotAt(e);
        const E = cur();
        const M = E.map();

        return s && M ? posAt(M, E.text(), s.page, s.x, s.y, enterMath) : E.text().length;
    }

    // ---- adding a text box: the button, then a click on the page
    const addBtn = $('#g-textbox');

    function setPlacing(on) {
        placing = on;
        wrap.classList.toggle('placing', on);
        addBtn.classList.toggle('on', on);
        if (on) status('Click on the page where the text box goes', 4000);
    }

    addBtn.addEventListener('click', () => setPlacing(!placing));

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && placing) setPlacing(false);
    });

    function placeBox(s) {
        const r = res();
        const size = settings.gen.size;
        const onPaper = !!r.page;
        const w = Math.max(3 * size, Math.round(onPaper ? r.width * 0.4 : 400));
        // the first line's caret lands about where the click was
        const x = Math.round(onPaper ? clamp(s.x, 0, Math.max(0, r.width - w - 20)) : Math.max(0, s.x));
        const y = Math.round(Math.max(0, s.y - 0.75 * size));
        const b = { id: uid(), text: '', x, y, w, size, page: onPaper ? s.page : 0 };
        boxes().push(b);
        addRegion(b);
        saveSettings();
        activate(b.id);
        regenerate();
        cur().ta.focus({ preventScroll: true });
        cur().changed();
    }

    // ---- moving and widening a text box by its handles
    function startDrag(e, kind) {
        const b = boxById(active);
        const s = spotAt(e);
        if (!b || !s) return;

        drag = { b, kind, x0: e.clientX, y0: e.clientY, scale: s.scale, bx: b.x, by: b.y, bw: b.w };
        wrap.classList.add('dragging');
    }

    function dragTo(e) {
        const { b, kind, scale } = drag;
        const dx = (e.clientX - drag.x0) * scale;
        const dy = (e.clientY - drag.y0) * scale;
        const r = res();
        const W = r.page ? r.width : Infinity;
        const H = r.page ? r.height : Infinity;

        if (kind === 'move') {
            b.x = Math.round(clamp(drag.bx + dx, -b.w / 2, W - 40));
            b.y = Math.round(clamp(drag.by + dy, 0, H - 40));
        } else b.w = Math.round(clamp(drag.bw + dx, 2 * b.size, W - b.x));

        textChanged();
    }

    $('#g-preview').addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !res() || !res().caretMap) return;

        const s = spotAt(e);

        if (placing) {
            e.preventDefault();
            setPlacing(false);
            if (s) placeBox(s);

            return;
        }

        const grip = e.target.closest('.ed-box-move, .ed-box-size, .ed-box-del');

        if (grip) {
            e.preventDefault();
            if (grip.classList.contains('ed-box-del')) removeBox(active);
            else startDrag(e, grip.classList.contains('ed-box-move') ? 'move' : 'width');

            return;
        }

        e.preventDefault();
        if (s) activate(boxAt(s) || 'main');
        cur().ta.focus({ preventScroll: true });
        pressed = true;
        cur().pointerDown(posUnder(e, e.detail < 2 && !e.shiftKey), e);
    });

    window.addEventListener('mousemove', (e) => {
        if (drag) dragTo(e);
        else if (pressed && e.buttons & 1) cur().pointerDrag(posUnder(e, false));
    });

    window.addEventListener('mouseup', () => {
        if (drag) {
            drag = null;
            wrap.classList.remove('dragging');
            saveSettings();
            cur().ta.focus({ preventScroll: true });
            regenerate();
        }

        if (pressed) {
            pressed = false;
            cur().pointerUp();
        }
    });

    return {
        draw,
        // the main text's equation being edited (see editor.js rawAt)
        rawAt: () => editors.get('main').rawAt(),
        // the text boxes, for generate()
        boxOptions: () => boxes().map((b) => ({ ...b, rawAt: editors.get(b.id)?.rawAt() ?? -1 })),
    };
}
