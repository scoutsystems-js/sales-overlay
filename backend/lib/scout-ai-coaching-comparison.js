'use strict';

// Scout AI does not create a second coaching writer. It joins the existing
// grounded Objections coaching summary to the exact cohort and call evidence
// the conversation already exposes.

function comparisonFromSavedCoaching(input) {
  input = input || {};
  var cohort = input.cohort || {};
  var synthesis = input.synthesis || {};
  var category = input.category || null;
  var saved = (synthesis.categories || []).find(function (item) {
    return item && item.category === category;
  }) || {};
  return {
    kind: 'objection_coaching_comparison',
    window: cohort.window || input.window || null,
    closer: { user_id: input.userId || null, name: input.name || 'Closer name not recorded' },
    category: category,
    handle_rate: cohort.objection_handle_rate || null,
    when_handled: (cohort.handled_examples || []).length >= 2 ? (saved.when_handled || null) : null,
    when_not_handled: (cohort.not_handled_examples || []).length >= 2 ? (saved.when_not_handled || null) : null,
    handled_examples: cohort.handled_examples || [],
    not_handled_examples: cohort.not_handled_examples || [],
  };
}

module.exports = { comparisonFromSavedCoaching: comparisonFromSavedCoaching };
