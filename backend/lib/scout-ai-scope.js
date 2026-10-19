'use strict';

// Scout AI always starts with the viewer's current role and current team
// assignments. It never trusts a closer name or prior chat message to expand
// that scope.
var { withBoardOwner, membersByManager } = require('./team-membership');

function activeProfiles(profiles) {
  return (profiles || []).filter(function (profile) {
    return profile && profile.user_id && profile.active !== false;
  });
}

function visibleUserIds(actor, profiles, sharedAssignments) {
  var active = activeProfiles(profiles);
  var role = actor && actor.role;
  var actorId = actor && actor.id;
  if (!actorId) return [];
  if (role === 'owner') {
    return active.filter(function (profile) {
      return profile.role !== 'owner' || profile.user_id === actorId;
    }).map(function (profile) { return profile.user_id; });
  }
  if (role === 'manager') {
    var members = membersByManager(active, sharedAssignments);
    return withBoardOwner(actorId, members[actorId] || []).filter(function (id) {
      return active.some(function (profile) { return profile.user_id === id; });
    });
  }
  return active.some(function (profile) { return profile.user_id === actorId; }) ? [actorId] : [];
}

module.exports = { visibleUserIds: visibleUserIds };
