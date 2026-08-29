/**
 * scout-modal.js — in-page replacements for confirm() and prompt().
 *
 * ONE implementation, loaded by BOTH admin.html and dashboard.html. They are
 * separate documents with no shared bundle, so the alternative was a mirrored
 * copy — the duplication this codebase has repeatedly paid for.
 *
 * ⚠⚠ THE DANGEROUS PART OF THIS CHANGE IS NOT THE MARKUP, IT IS THE CONTROL
 * FLOW. `confirm()` is synchronous and returns a boolean; these return a
 * PROMISE, and a promise is ALWAYS TRUTHY. So a call site converted without
 * `await`:
 *
 *     if (!scoutConfirm('Delete?')) return;   // <-- NEVER returns
 *
 * silently loses its guard and proceeds to the destructive action every time.
 * It throws nothing and reads correctly. Every call site must be `await`ed
 * inside an async function, and test/modals.test.js asserts exactly that.
 *
 * ⚠ THE TYPED CONFIRMATION SURVIVES. Delete-a-user and delete-a-company both
 * require the exact email/name to be typed back; that is the only friction
 * standing in front of an irreversible act, and it is not softened here.
 */
(function () {
  'use strict';

  var openCount = 0;

  /* ⚠⚠ THE CSS LIVES HERE, NOT IN THE TWO PAGES, for the same reason the JS
     does: two copies drift. Injected once on load.

     ⚠ EVERY TOKEN CARRIES A FALLBACK, and that is not defensiveness — it is
     measured. `admin.html` USES var(--bg-field), var(--border-strong),
     var(--accent) and var(--bad) but NOTHING DEFINES THEM on that page:
     /css/style.css declares only --text and --muted. Without fallbacks this
     modal would render unstyled on exactly the page whose delete flows most
     need to look deliberate. */
  var CSS = [
    '.scout-modal-backdrop{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;',
    'justify-content:center;background:rgba(0,0,0,0.62);padding:20px;}',
    '.scout-modal{background:var(--bg-elevated,#131313);color:var(--text,#ededed);',
    'border:1px solid var(--border-strong,#333);border-radius:10px;max-width:460px;width:100%;',
    'padding:20px 22px;box-shadow:0 18px 50px rgba(0,0,0,0.5);font-size:14px;line-height:1.5;}',
    '.scout-modal-title{margin:0 0 10px;font-size:16px;font-weight:600;color:var(--text,#ededed);}',
    '.scout-modal-body{margin:0 0 10px;color:var(--text,#ededed);}',
    '.scout-modal-input{width:100%;box-sizing:border-box;margin:4px 0 2px;padding:9px 10px;',
    'background:var(--bg-field,#0d0d0d);color:var(--text,#ededed);',
    'border:1px solid var(--border-strong,#333);border-radius:6px;font-size:14px;}',
    '.scout-modal-err{color:var(--bad,#f87171);font-size:13px;margin:6px 0 0;}',
    '.scout-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}',
    '.scout-modal-btn{padding:8px 14px;border-radius:6px;font-size:13.5px;cursor:pointer;',
    'background:var(--bg-field,#0d0d0d);color:var(--text,#ededed);',
    'border:1px solid var(--border-strong,#333);}',
    '.scout-modal-btn:hover{border-color:var(--text,#ededed);}',
    '.scout-modal-primary{border-color:var(--accent,#09e046);color:var(--accent,#09e046);}',
    '.scout-modal-danger{border-color:var(--bad,#f87171);color:var(--bad,#f87171);}',
    '.scout-modal-btn:focus-visible{outline:2px solid var(--accent,#09e046);outline-offset:2px;}'
  ].join('');

  function ensureCss() {
    if (document.getElementById('scout-modal-css')) return;
    var st = document.createElement('style');
    st.id = 'scout-modal-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    // Dialog bodies carry user-supplied values (an email, a company name), so
    // text is assigned as content and never parsed as markup.
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * The one builder. Returns a promise resolving to:
   *   confirm  -> true | false
   *   prompt   -> the string | null
   */
  function openModal(opts) {
    var o = opts || {};
    var isPrompt = o.kind === 'prompt';
    var mustMatch = (typeof o.mustMatch === 'string' && o.mustMatch) ? o.mustMatch : null;

    return new Promise(function (resolve) {
      /* ⚠ Remember who opened it. A modal that swallows focus and never gives
         it back strands a keyboard user on the page behind it. */
      ensureCss();
      var opener = document.activeElement;
      var done = false;

      var back = el('div', 'scout-modal-backdrop');
      var box = el('div', 'scout-modal');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');

      var titleId = 'scout-modal-title-' + (++openCount);
      var h = el('h2', 'scout-modal-title', o.title || 'Are you sure?');
      h.id = titleId;
      box.setAttribute('aria-labelledby', titleId);
      box.appendChild(h);

      if (o.body) {
        /* Multi-line messages arrive as \n from the old confirm() strings —
           one paragraph per line keeps them readable without any HTML. */
        String(o.body).split('\n').forEach(function (line) {
          if (line.trim() === '') return;
          box.appendChild(el('p', 'scout-modal-body', line));
        });
      }

      var input = null;
      if (isPrompt) {
        input = el('input', 'scout-modal-input');
        input.type = 'text';
        input.value = o.value || '';
        if (o.placeholder) input.placeholder = o.placeholder;
        input.setAttribute('aria-label', o.inputLabel || o.title || 'Value');
        box.appendChild(input);
      }

      var err = el('div', 'scout-modal-err');
      err.style.display = 'none';
      box.appendChild(err);

      var row = el('div', 'scout-modal-actions');
      var cancel = el('button', 'scout-modal-btn', o.cancelText || 'Cancel');
      cancel.type = 'button';
      var ok = el('button', 'scout-modal-btn scout-modal-primary'
        + (o.danger ? ' scout-modal-danger' : ''), o.confirmText || 'Confirm');
      ok.type = 'button';
      row.appendChild(cancel);
      row.appendChild(ok);
      box.appendChild(row);
      back.appendChild(box);

      function close(result) {
        if (done) return;                 // idempotent: Escape + click can race
        done = true;
        document.removeEventListener('keydown', onKey, true);
        if (back.parentNode) back.parentNode.removeChild(back);
        /* ⚠ Return focus to whatever opened it, if it is still on the page. */
        try { if (opener && opener.focus && document.contains(opener)) opener.focus(); } catch (e) {}
        resolve(result);
      }

      function accept() {
        if (isPrompt) {
          var v = input.value;
          /* ⚠ TWO CALL SITES, TWO MATCH RULES, BOTH PRESERVED EXACTLY.
             Deleting a user accepts "delete" in any case; deleting a company
             requires the name typed exactly. Loosening either to make one
             option fit would weaken a confirmation standing in front of an
             irreversible act. */
          var typed = v.trim(), want = mustMatch;
          if (o.matchCaseInsensitive) { typed = typed.toUpperCase(); want = want.toUpperCase(); }
          if (mustMatch && typed !== want) {
            /* ⚠ THE TYPED CONFIRMATION IS NOT SOFTENED. A mismatch does not
               close the dialog and does not proceed — it says so and waits. */
            err.textContent = o.mismatchText || 'That did not match. Nothing was changed.';
            err.style.display = '';
            input.focus();
            input.select();
            return;
          }
          close(v);
          return;
        }
        close(true);
      }

      cancel.addEventListener('click', function () { close(isPrompt ? null : false); });
      ok.addEventListener('click', accept);
      back.addEventListener('mousedown', function (e) {
        /* Backdrop click cancels. Cancelling is always the safe direction, so
           it needs no confirmation of its own. */
        if (e.target === back) close(isPrompt ? null : false);
      });

      /* ⚠ A REAL FOCUS TRAP. Without it Tab walks into the page behind the
         modal, which is both an accessibility failure and a way to click the
         thing the dialog is asking about. */
      function focusables() {
        return Array.prototype.slice.call(
          box.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter(function (n) { return !n.disabled && n.offsetParent !== null; });
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(isPrompt ? null : false); return; }
        if (e.key === 'Enter' && (!isPrompt || document.activeElement === input)) {
          e.preventDefault(); accept(); return;
        }
        if (e.key !== 'Tab') return;
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(back);
      (isPrompt ? input : ok).focus();
      /* The copy-to-clipboard fallbacks show text TO BE COPIED rather than
         asking a question, so the value is pre-selected exactly as the old
         window.prompt did. */
      if (isPrompt && o.selectOnOpen) { try { input.select(); } catch (e) {} }
    });
  }

  window.scoutConfirm = function (opts) {
    return openModal(typeof opts === 'string' ? { body: opts } : (opts || {}));
  };
  window.scoutPrompt = function (opts) {
    var o = typeof opts === 'string' ? { body: opts } : (opts || {});
    o.kind = 'prompt';
    return openModal(o);
  };
  window._scoutModalOpenCount = function () {
    return document.querySelectorAll('.scout-modal-backdrop').length;
  };
})();
