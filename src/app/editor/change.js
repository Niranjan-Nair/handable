// An edit to the text, as the editor's text functions return it:
//   { a, b, str }          replace a … b with str (the caret ends up after it)
//   { a, b, str, selA, selB }  … then select selA … selB
//   { selA, selB }         only move the selection
// null from a key handler means "not mine: let the key do what it normally does".

// the edit that turns text t into t2 (only the part that differs, so it's one small
// undo step), then selects selA … selB
export function replaceChange(t, t2, selA, selB = selA) {
    if (t2 === t) return { selA, selB };

    let p = 0;
    while (p < t.length && p < t2.length && t[p] === t2[p]) p++;
    let q = 0;
    while (q < t.length - p && q < t2.length - p && t[t.length - 1 - q] === t2[t2.length - 1 - q]) q++;

    return { a: p, b: t.length - q, str: t2.slice(p, t2.length - q), selA, selB };
}
