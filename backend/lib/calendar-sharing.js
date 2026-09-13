'use strict';

function currentManagerId(profile) {
  if (!profile || profile.active === false) return null;
  if (profile.managed_by) return profile.managed_by;
  if (profile.role === 'manager' || profile.role === 'owner') return profile.user_id;
  return null;
}

function sharingEligibility(profile) {
  const managerId = currentManagerId(profile);
  return { managerId, eligible: managerId !== null };
}

function sharedCountStatus(profile, connection, viewerRole, viewerId) {
  const eligibility = sharingEligibility(profile);
  if (!eligibility.eligible) return 'unsupported';
  if (!connection) return 'not_connected';
  if (viewerRole !== 'owner' && viewerId !== eligibility.managerId) return 'unavailable';
  if (connection.share_scheduled_count !== true || connection.share_manager_id !== eligibility.managerId) return 'not_sharing';
  return 'ready';
}

module.exports = { currentManagerId, sharingEligibility, sharedCountStatus };
