import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import {
    IAIChatMessage,
    IAIConversation,
    IAIPanelSettings,
    IAIPanelState,
} from '../../common/ai';

type AIStateFile = {
    version: 1;
    settings: IAIPanelSettings;
    conversations: Record<string, IAIConversation>;
};

const DEFAULT_SETTINGS: IAIPanelSettings = {
    apiKey: '',
    model: 'gpt-5.4',
    maxOutputTokens: 12000,
    minOutputTokens: 100,
};

const MAX_SAVED_MESSAGES = 60;

export default class AIStateManager {
    private static get stateFilePath() {
        return path.join(app.getPath('userData'), 'ai', 'panel-state.json');
    }

    private static createEmptyState(): AIStateFile {
        return {
            version: 1,
            settings: { ...DEFAULT_SETTINGS },
            conversations: {},
        };
    }

    private static async ensureStateDirectory() {
        await fs.promises.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    }

    private static sanitizeNumber(
        value: unknown,
        fallback: number,
        { min, max }: { min: number; max: number }
    ) {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) {
            return fallback;
        }
        return Math.min(max, Math.max(min, Math.round(parsed)));
    }

    static sanitizeSettings(settings?: Partial<IAIPanelSettings>): IAIPanelSettings {
        return {
            apiKey: typeof settings?.apiKey === 'string' ? settings.apiKey.trim() : '',
            model:
                typeof settings?.model === 'string' && settings.model.trim()
                    ? settings.model.trim()
                    : DEFAULT_SETTINGS.model,
            maxOutputTokens: this.sanitizeNumber(
                settings?.maxOutputTokens,
                DEFAULT_SETTINGS.maxOutputTokens,
                { min: 256, max: 32768 }
            ),
            minOutputTokens: this.sanitizeNumber(
                settings?.minOutputTokens,
                DEFAULT_SETTINGS.minOutputTokens,
                { min: 0, max: 32000 }
            ),
        };
    }

    private static sanitizeMessage(message?: Partial<IAIChatMessage>) {
        if (!message || typeof message.content !== 'string' || typeof message.role !== 'string') {
            return undefined;
        }

        const role =
            message.role === 'user' || message.role === 'assistant' || message.role === 'error' ?
                message.role :
                undefined;

        if (!role || !message.content.trim()) {
            return undefined;
        }

        const changeSummary = Array.isArray(message.changeSummary) ?
            message.changeSummary.filter((item): item is string => typeof item === 'string') :
            undefined;

        return {
            id:
                typeof message.id === 'string' && message.id.trim() ?
                    message.id :
                    `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            role,
            content: message.content.trim(),
            createdAt:
                typeof message.createdAt === 'string' && message.createdAt.trim() ?
                    message.createdAt :
                    new Date().toISOString(),
            ...(changeSummary && changeSummary.length ? { changeSummary } : {}),
        } as IAIChatMessage;
    }

    static sanitizeConversation(conversation?: Partial<IAIConversation>): IAIConversation {
        const conversationMessages =
            conversation && Array.isArray(conversation.messages) ? conversation.messages : [];
        const sanitizedMessages = conversationMessages.length ?
            conversationMessages
                .map((message) => this.sanitizeMessage(message))
                .filter((message): message is IAIChatMessage => Boolean(message))
                .slice(-MAX_SAVED_MESSAGES) :
            [];

        return {
            messages: sanitizedMessages,
            projectName:
                typeof conversation?.projectName === 'string' && conversation.projectName.trim() ?
                    conversation.projectName.trim() :
                    undefined,
            updatedAt:
                typeof conversation?.updatedAt === 'string' && conversation.updatedAt.trim() ?
                    conversation.updatedAt :
                    new Date().toISOString(),
        };
    }

    private static sanitizeConversations(conversations: unknown) {
        if (!conversations || typeof conversations !== 'object') {
            return {};
        }

        return Object.entries(conversations as Record<string, unknown>).reduce(
            (acc, [key, conversation]) => {
                if (key) {
                    acc[key] = this.sanitizeConversation(conversation as Partial<IAIConversation>);
                }
                return acc;
            },
            {} as Record<string, IAIConversation>
        );
    }

    private static async readState(): Promise<AIStateFile> {
        try {
            const raw = await fs.promises.readFile(this.stateFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                version: 1,
                settings: this.sanitizeSettings(parsed?.settings),
                conversations: this.sanitizeConversations(parsed?.conversations),
            };
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.warn('Failed to read AI panel state:', error);
            }
            return this.createEmptyState();
        }
    }

    private static async writeState(state: AIStateFile) {
        await this.ensureStateDirectory();
        await fs.promises.writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    }

    static async getPanelState(projectKey: string): Promise<IAIPanelState> {
        const state = await this.readState();
        return {
            settings: state.settings,
            conversation:
                state.conversations[projectKey] ||
                this.sanitizeConversation({ messages: [] }),
            storagePath: this.stateFilePath,
        };
    }

    static async saveSettings(settings: Partial<IAIPanelSettings>): Promise<IAIPanelSettings> {
        const state = await this.readState();
        state.settings = this.sanitizeSettings({ ...state.settings, ...settings });
        await this.writeState(state);
        return state.settings;
    }

    static async saveConversation(
        projectKey: string,
        conversation: IAIConversation
    ): Promise<IAIConversation> {
        const state = await this.readState();
        const sanitizedConversation = this.sanitizeConversation(conversation);

        if (!sanitizedConversation.messages.length) {
            delete state.conversations[projectKey];
        } else {
            state.conversations[projectKey] = sanitizedConversation;
        }

        await this.writeState(state);
        return sanitizedConversation;
    }

    static async clearConversation(projectKey: string) {
        const state = await this.readState();
        delete state.conversations[projectKey];
        await this.writeState(state);
    }

    static async copyConversation(
        sourceProjectKey: string,
        targetProjectKey: string,
        projectName?: string
    ) {
        if (!sourceProjectKey || !targetProjectKey || sourceProjectKey === targetProjectKey) {
            return;
        }

        const state = await this.readState();
        const sourceConversation = state.conversations[sourceProjectKey];

        if (!sourceConversation) {
            return;
        }

        state.conversations[targetProjectKey] = this.sanitizeConversation({
            ...sourceConversation,
            projectName: projectName || sourceConversation.projectName,
            updatedAt: new Date().toISOString(),
        });
        await this.writeState(state);
    }
}
