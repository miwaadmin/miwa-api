const {
  getClientAssessments,
  createAssistantAction,
  emitAssistantAction,
} = require('./deps');

module.exports = async function getClientAssessmentsHandler({ args, db, therapistId, send, resolvePatient }) {
  const patient = await resolvePatient(args.client_id);
  if (!patient) return { error: 'Client not found' };
  const data = await getClientAssessments(db, therapistId, patient.id, args.limit || 5);
  if (data) {
    const latest = data.assessments?.[data.assessments.length - 1];
    emitAssistantAction(send, createAssistantAction('risk_review', {
      title: `Review ${data.clientName}'s scores`,
      summary: latest
        ? `${latest.type || 'Assessment'} ${latest.score ?? 'n/a'}${latest.severity ? ` (${latest.severity})` : ''}`
        : 'No recent assessment scores available.',
      status: data.assessments?.length ? 'ready' : 'empty',
      payload: {
        patientId: patient.id,
        clientId: data.clientId,
        clientName: data.clientName,
        assessments: data.assessments || [],
      },
    }));
  }
  return data || { error: 'No assessment data found' };
};
