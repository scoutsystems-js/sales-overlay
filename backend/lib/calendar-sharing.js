'use strict';

// The GHL signature used by Scout was measured only for Sober Living Riches.
// Another team must be measured before its calendar can produce a count.
const SUPPORTED_CALENDAR_TEAM_ID = '40616e16-a92b-45c4-99b8-b3d12e508bf6';

function currentManagerId(profile) {
  if (!profile || profile.active === false) return null;
  if (profile.managed_by) return profile.managed_by;
  if (profile.role === 'manager' || profile.role === 'owner') return profile.user_id;
  return null;
}

function sharingEligibility(profile) {
  const managerId = currentManagerId(profile);
  return { managerId, eligible: managerId === SUPPORTED_CALENDAR_TEAM_ID };
}

function sharedCountStatus(profile, connection, viewerRole, viewerId) {
  const eligibility = sharingEligibility(profile);
  if (!eligibility.eligible) return 'unsupported';
  if (!connection) return 'not_connected';
  if (viewerRole !== 'owner' && viewerId !== eligibility.managerId) return 'unavailable';
  if (connection.share_scheduled_count !== true || connection.share_manager_id !== eligibility.managerId) return 'not_sharing';
  return 'ready';
}

module.exports = { SUPPORTED_CALENDAR_TEAM_ID, currentManagerId, sharingEligibility, sharedCountStatus };
