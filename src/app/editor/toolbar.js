// The editor's toolbar: format buttons (showing the formats of the selection, or of
// the caret), the highlighter's colors, lists (the button turns the selected
// paragraphs into list items, or back; its menu picks the kind: a bullet, your own
// marker, or numbers and how they're written, and where the numbering starts), and
// the size of the text being edited.
import * as HW from '../../engine/index.js';
import { $, $$ } from '../dom.js';
import { listSettings, saveSettings } from '../store.js';
import { allListed, leadOf, setList, setStart } from './leads.js';

// how a number is written: "1." "1)" "(1)"
const FORMS = { '.': ['', '.'], ')': ['', ')'], '()': ['(', ')'] };
const BULLETS = ['•', '-', '+', '>'];
// the sizes in the size menu
const SIZES = [20, 24, 28, 35, 40, 48, 56, 72, 96];

// ed: the region being edited ({ ta, text, apply, changed, formats, toggleFormat, size,
// setSize }, see page.js)
export function createToolbar(ed) {
    let lastHl = 'yellow'; // the highlighter color last used
    const focus = () => ed.ta.focus({ preventScroll: true });
    const sel = () => [ed.ta.selectionStart, ed.ta.selectionEnd];
    // clicking a toolbar button keeps the selection
    const keepCaret = (el) => el.addEventListener('mousedown', (e) => e.preventDefault());
    $$('.fmt-bar button').forEach(keepCaret);

    // ---- formats
    $$('.fmt-bar [data-fmt]').forEach((btn) =>
        btn.addEventListener('click', () => {
            focus();
            const k = btn.dataset.fmt;
            if (k === 'mark') ed.toggleFormat('mark', ed.formats().color || lastHl);
            else ed.toggleFormat(k);
        }),
    );

    $$('.fmt-bar [data-cmd]').forEach((btn) =>
        btn.addEventListener('click', () => {
            focus();
            document.execCommand(btn.dataset.cmd); // undo, redo
            ed.changed();
        }),
    );

    // ---- a menu that opens from a button, and closes on a click elsewhere or Escape
    function popup(menu, button, group, onOpen) {
        const close = () => {
            menu.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        };

        button.addEventListener('click', () => {
            menu.hidden = !menu.hidden;
            button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
            if (!menu.hidden && onOpen) onOpen();
        });

        document.addEventListener('mousedown', (e) => {
            if (!menu.hidden && !e.target.closest(group)) close();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !menu.hidden) close();
        });

        return close;
    }

    // ---- the highlighter's colors
    const hlMenu = $('.hl-menu');
    const closeHl = popup(hlMenu, $('.fmt-bar .hl-more'), '.hl-group');

    $$('.hl-menu button').forEach((b) => {
        keepCaret(b);

        b.addEventListener('click', () => {
            focus();
            const c = b.dataset.color;
            if (c) {
                lastHl = c;
                const f = ed.formats();
                if (!(f.mark && f.color === c)) ed.toggleFormat('mark', c);
            } else ed.toggleFormat('mark', null, true); // None
            closeHl();
        });
    });

    // ---- lists
    const listMenu = $('.list-menu');
    const closeList = popup(listMenu, $('.fmt-bar .list-more'), '.list-group', () => drawListMenu());
    const custom = $('.lm-custom');
    const startIn = $('.lm-start-n');

    function drawListMenu() {
        const L = leadOf(ed.text(), ed.ta.selectionStart);
        const ls = listSettings();
        const ul = L.bullet && L.bullet.ul;
        const ol = L.bullet && L.bullet.ol;
        const shown = ol || ls.ol;
        $$('.list-menu [data-ul]').forEach((b) => b.classList.toggle('on', ul === b.dataset.ul));
        $$('.list-menu [data-kind]').forEach((b) => b.classList.toggle('on', !!ol && ol.kind === b.dataset.kind));

        $$('.list-menu [data-form]').forEach((b) => {
            const [pre, post] = FORMS[b.dataset.form];
            b.textContent = pre + HW.listNumber(1, shown.kind) + post;
            b.classList.toggle('on', !!ol && ol.pre === pre && ol.post === post);
        });

        const isCustom = ul != null && !BULLETS.includes(ul);
        if (document.activeElement !== custom) custom.value = isCustom ? ul : '';
        custom.classList.toggle('on', isCustom);
        if (document.activeElement !== startIn) startIn.value = ol && ol.start != null ? ol.start : '';
    }

    // the list button: on the selection's paragraphs (all lists of the type already: none)
    function toggleList(type) {
        const ls = listSettings();
        type = type || ls.last;
        const [a, b] = sel();
        if (allListed(ed.text(), a, b, type)) return ed.apply(setList(ed.text(), a, b, null));

        ls.last = type;
        saveSettings();
        ed.apply(setList(ed.text(), a, b, type === 'ol' ? { ol: { ...ls.ol, start: null } } : { ul: ls.ul }, true));
    }

    $('.fmt-bar .list-main').addEventListener('click', () => {
        focus();
        toggleList();
    });

    const useBullet = (v) => {
        const ls = listSettings();
        ls.ul = v;
        ls.last = 'ul';
        saveSettings();
        focus();
        ed.apply(setList(ed.text(), ...sel(), { ul: v }));
        closeList();
    };

    // numbers: the kind and how it's written are picked separately, so the menu stays open
    const useNumbers = (change) => {
        const ls = listSettings();
        const L = leadOf(ed.text(), ed.ta.selectionStart);
        const cur = (L.bullet && L.bullet.ol) || ls.ol;
        const ol = { pre: cur.pre, kind: cur.kind, post: cur.post, ...change };
        ls.ol = ol;
        ls.last = 'ol';
        saveSettings();
        focus();
        ed.apply(setList(ed.text(), ...sel(), { ol: { ...ol, start: null } }));
        drawListMenu();
    };

    $$('.list-menu [data-ul]').forEach((b) => b.addEventListener('click', () => useBullet(b.dataset.ul)));
    $$('.list-menu [data-kind]').forEach((b) =>
        b.addEventListener('click', () => useNumbers({ kind: b.dataset.kind })),
    );

    $$('.list-menu [data-form]').forEach((b) =>
        b.addEventListener('click', () => {
            const [pre, post] = FORMS[b.dataset.form];
            useNumbers({ pre, post });
        }),
    );

    $('.list-menu .lm-none').addEventListener('click', () => {
        focus();
        ed.apply(setList(ed.text(), ...sel(), null));
        closeList();
    });

    // a menu field: Enter (or leaving it) uses it, Escape closes the menu
    const field = (input, use) => {
        input.addEventListener('change', use);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                use();
            }

            if (e.key === 'Escape') {
                closeList();
                focus();
            }
        });
    };

    // your own marker
    field(custom, () => {
        const v = custom.value.replace(/\s+/g, '');
        if (v) useBullet(v);
    });

    // where the item's numbering starts (empty: counting on from the item before)
    field(startIn, () => {
        const v = startIn.value.trim();
        const n = v === '' ? null : Math.trunc(+v);
        if (v !== '' && !Number.isFinite(n)) return;

        ed.apply(setStart(ed.text(), ...sel(), listSettings().ol, n));
        focus();
        drawListMenu();
    });

    // ---- the size of the selection (or the sized stretch the caret is in), or else of
    // the text being edited (the main text, or a text box)
    const sizeIn = $('.fmt-bar .size-n');
    const sizeMenu = $('.size-menu');
    let sizing = false; // a size being set

    // Sets size v. The text goes back to the page first: leaving the size field fires
    // its change, which mustn't set the size again halfway through (it would be worked
    // out on the text as it was, and written over the text as it is).
    function useSize(v) {
        if (sizing) return;

        sizing = true;

        try {
            if (document.activeElement === sizeIn) focus();
            if (Number.isFinite(v) && v > 0) ed.setSize(v);
        } finally {
            sizing = false;
        }

        sizeIn.value = ed.size();
    }

    sizeIn.addEventListener('change', () => useSize(+sizeIn.value));

    sizeIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            useSize(+sizeIn.value);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            sizeIn.value = ed.size(); // (so leaving it changes nothing)
            focus();
        }
    });

    $$('.fmt-bar [data-size-step]').forEach((b) =>
        // (from the size shown, which may have just been typed; blank: sizes differ)
        b.addEventListener('click', () => useSize((+sizeIn.value || ed.baseSize()) + +b.dataset.sizeStep)),
    );

    // as in Google Docs, the field opens a list of sizes under it (and can still be typed in)
    sizeMenu.innerHTML = SIZES.map((v) => `<button type="button" data-size="${v}">${v}</button>`).join('');

    function openSizes() {
        const cur = sizeIn.value;
        $$('.size-menu button').forEach((b) => b.classList.toggle('on', b.dataset.size === cur));
        sizeMenu.hidden = false;
    }

    // a click into it selects the size, to type over (the click's own mouseup would
    // put a caret in instead)
    let selecting = false;

    sizeIn.addEventListener('focus', () => {
        sizeIn.select();
        selecting = true;
        openSizes();
    });

    sizeIn.addEventListener('mouseup', (e) => {
        if (selecting) e.preventDefault();
        selecting = false;
    });

    sizeIn.addEventListener('blur', () => {
        sizeMenu.hidden = true;
    });

    // (picking one keeps the focus in the field until the size is set)
    $$('.size-menu button').forEach((b) => {
        keepCaret(b);
        b.addEventListener('click', () => useSize(+b.dataset.size));
    });

    // the buttons show what's on where the caret is
    function draw() {
        if (document.activeElement !== sizeIn) sizeIn.value = ed.size();
        const focused = document.activeElement === ed.ta;
        const f = focused ? ed.formats() : {};

        $$('.fmt-bar [data-fmt]').forEach((btn) => {
            const on = !!f[btn.dataset.fmt];
            btn.classList.toggle('on', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        const hl = $('.fmt-bar .hl-main');
        if (hl) hl.style.setProperty('--hl', HW.HIGHLIGHTS[(f.mark && f.color) || lastHl]);
        $$('.hl-menu [data-color]').forEach((b) => b.classList.toggle('on', !!f.mark && f.color === b.dataset.color));
        const lm = $('.fmt-bar .list-main');
        const on = focused && !!leadOf(ed.text(), ed.ta.selectionStart).bullet;
        lm.classList.toggle('on', on);
        lm.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (!listMenu.hidden) drawListMenu();
    }

    return { draw, toggleList, lastHighlight: () => lastHl };
}
