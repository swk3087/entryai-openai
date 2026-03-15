export interface IAIPanelSettings {
    apiKey: string;
    model: string;
    maxOutputTokens: number;
    minOutputTokens: number;
}

export type AIChatRole = 'user' | 'assistant' | 'error';

export interface IAIChatMessage {
    id: string;
    role: AIChatRole;
    content: string;
    createdAt: string;
    changeSummary?: string[];
}

export interface IAIConversation {
    messages: IAIChatMessage[];
    projectName?: string;
    updatedAt?: string;
}

export interface IAIPanelState {
    settings: IAIPanelSettings;
    conversation: IAIConversation;
    storagePath: string;
}

export interface IAIGenerateProjectRequest {
    projectName: string;
    prompt: string;
    currentProject: Record<string, any>;
    messages: IAIChatMessage[];
    settings: IAIPanelSettings;
}

export interface IAIProjectUpdateResponse {
    assistantMessage: string;
    changeSummary: string[];
    updatedProject: Record<string, any>;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
}

export interface IAIProjectMeta {
    aiProjectId: string;
    savedPath?: string;
}
