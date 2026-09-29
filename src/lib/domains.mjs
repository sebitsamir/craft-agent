/**
 * Discovery metadata only. A planned domain is not an implemented capability.
 * Actual tools, validators and qualified review workflows arrive in later phases.
 */
export const domains = Object.freeze([
  { id: 'software', status: 'bootstrap', exampleOutputs: ['code', 'app', 'test report'] },
  { id: 'film', status: 'planned', exampleOutputs: ['script', 'storyboard', 'edited video'] },
  { id: 'game', status: 'planned', exampleOutputs: ['design document', 'playable build', 'assets'] },
  { id: 'medicine', status: 'planned', reviewHint: 'consequential-use', exampleOutputs: ['educational material', 'research synthesis'] },
  { id: 'accounting', status: 'planned', reviewHint: 'consequential-use', exampleOutputs: ['worksheet', 'reconciliation', 'report'] },
  { id: 'law', status: 'planned', reviewHint: 'consequential-use', exampleOutputs: ['research memo', 'draft document'] },
  { id: 'education', status: 'planned', exampleOutputs: ['lesson', 'assessment', 'learning resource'] },
  { id: 'astronomy', status: 'planned', exampleOutputs: ['calculation', 'visualization', 'research report'] },
]);

export function domainById(id) {
  return domains.find((domain) => domain.id === id) ?? null;
}
