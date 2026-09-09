export type RepoGitErrorCode =
  | 'bad_feedback_id'
  | 'id_mismatch'
  | 'digest_mismatch'
  | 'bad_signature'
  | 'expired'
  | 'malformed'
  | 'unknown_base'
  | 'untrusted_base'
  | 'apply_failed'
  | 'push_failed'
  | 'remote_failed'
  | 'bad_remote'
  | 'not_configured'
  | 'pr_failed'
  | 'pr_closed';

export class RepoGitError extends Error {
  constructor(
    readonly code: RepoGitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RepoGitError';
  }
}
