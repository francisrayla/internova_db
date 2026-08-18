export function canAccess(role, feature) {
  return Boolean(role && feature);
}
