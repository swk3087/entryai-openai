import { IAIProjectMeta } from '../../common/ai';

function normalizeSavedPath(savedPath: string) {
    return savedPath.replace(/\\/g, '/').toLowerCase();
}

export function createAIProjectId() {
    return `project_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getFileAIProjectKey(savedPath: string) {
    return `file:${normalizeSavedPath(savedPath)}`;
}

export function getTempAIProjectKey(aiProjectId: string) {
    return `temp:${aiProjectId}`;
}

export function resolveAIProjectIdentity(savedPath?: string, aiProjectMeta?: IAIProjectMeta) {
    const aiProjectId = aiProjectMeta?.aiProjectId || createAIProjectId();

    return {
        aiProjectId,
        aiProjectKey:
            savedPath ? getFileAIProjectKey(savedPath) : getTempAIProjectKey(aiProjectId),
    };
}
