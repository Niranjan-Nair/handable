// The app: tabs, and keeping every view up to date with the training data.
import { $, $$ } from './dom.js';
import { updateOutputs } from './generate/panel.js';
import { runGen } from './generate/preview.js';
import { renderLibrary } from './library.js';
import { data, onDataChange, ui } from './store.js';
import { renderLetterGrid, showTrainTab } from './train/index.js';

function showTab(name) {
    ui.tab = name;
    $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
    if (name === 'train') showTrainTab();
    if (name === 'library') renderLibrary();

    if (name === 'generate') {
        updateOutputs();
        runGen();
    }

    if (name === 'home') renderHome();
}

function renderHome() {
    const n = data.samples.length;

    const note = n
        ? `Your handwriting model is built from ${n} sample${n === 1 ? '' : 's'}. It gets better as you add more.`
        : "You haven't written any samples yet. Start with a few letters.";

    const go = n ? 'Write something' : 'Start training';
    if ($('#home-note').textContent !== note) $('#home-note').textContent = note;
    if ($('#home-go').textContent !== go) $('#home-go').textContent = go;
}

onDataChange(() => {
    renderLetterGrid();
    if (ui.tab === 'library') renderLibrary();
    if (ui.tab === 'generate') runGen();
    renderHome();
});

$$('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#wordmark').addEventListener('click', () => showTab('home'));
$('#home-go').addEventListener('click', () => showTab(data.samples.length ? 'generate' : 'train'));

for (const init of [renderLetterGrid, updateOutputs, renderHome]) {
    try {
        init();
    } catch (e) {
        console.error('handable: start-up step failed', e);
    }
}
