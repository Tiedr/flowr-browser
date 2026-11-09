const baseUrl = process.env.DOKPLOY_URL?.replace(/\/$/, '');
const apiKey = process.env.DOKPLOY_API_KEY;
const domain = process.env.FLOWR_DOMAIN?.toLowerCase();

if (!baseUrl || !apiKey || !domain) {
  throw new Error('DOKPLOY_URL, DOKPLOY_API_KEY and FLOWR_DOMAIN are required.');
}

const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };
const projectsResponse = await fetch(`${baseUrl}/api/project.all`, { headers });
if (!projectsResponse.ok) {
  throw new Error(`Dokploy project lookup failed with HTTP ${projectsResponse.status}.`);
}

const projects = await projectsResponse.json();
const applications = [];
const visit = value => {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && typeof value.applicationId === 'string') applications.push(value);
  for (const child of Object.values(value)) visit(child);
};
visit(projects);

const unique = [...new Map(applications.map(application => [application.applicationId, application])).values()];
const exactDomainMatches = unique.filter(application => JSON.stringify(application).toLowerCase().includes(domain));
if (exactDomainMatches.length !== 1) {
  const flowrMatches = unique.filter(application => String(application.name || '').toLowerCase().includes('flowr'));
  if (flowrMatches.length === 1) exactDomainMatches.push(flowrMatches[0]);
}

const selected = [...new Map(exactDomainMatches.map(application => [application.applicationId, application])).values()];
if (selected.length !== 1) {
  const available = unique.map(application => application.name || application.applicationId).join(', ');
  throw new Error(`Expected exactly one Dokploy application for ${domain}; found ${selected.length}. Available applications: ${available || 'none'}.`);
}

const application = selected[0];
const deployResponse = await fetch(`${baseUrl}/api/application.deploy`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    applicationId: application.applicationId,
    title: 'Deploy Flowr website from GitHub',
    description: `GitHub commit ${process.env.GITHUB_SHA || 'manual dispatch'}`
  })
});

if (!deployResponse.ok) {
  const detail = await deployResponse.text();
  throw new Error(`Dokploy deployment failed with HTTP ${deployResponse.status}: ${detail.slice(0, 500)}`);
}

console.log(`Dokploy accepted the deployment for ${application.name || domain}.`);
