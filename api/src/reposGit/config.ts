import { RepoGitError } from './errors.js';

export function feedbackBranch(id: string): string {
  if (!/^[1-9][0-9]{0,18}$/.test(id)) {
    throw new RepoGitError('bad_feedback_id', 'feedback id must be a positive integer');
  }
  return `feedback/${id}`;
}

export function githubRepo(): string {
  const repo = process.env.FEEDBACK_GITHUB_REPO ?? 'otahesh/RepOS';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) {
    throw new RepoGitError('not_configured', 'FEEDBACK_GITHUB_REPO must be owner/repository');
  }
  return repo;
}

export function githubToken(): string {
  const token = process.env.FEEDBACK_GITHUB_TOKEN;
  if (!token || !/^[A-Za-z0-9_]+$/.test(token)) {
    throw new RepoGitError('not_configured', 'a valid FEEDBACK_GITHUB_TOKEN is required');
  }
  return token;
}
