import axios from 'axios';
import blockCatalog from '../../../codex/entry_ai_block_catalog_starter.json';
import {
    IAIChatMessage,
    IAIGenerateProjectRequest,
    IAIProjectUpdateResponse,
} from '../../common/ai';

const SYSTEM_PROMPT = [
    'You are the AI project editor inside Entry Offline.',
    'The user is editing an Entry project. You receive the conversation history, the latest user request, the current full project JSON, and an Entry block catalog.',
    'Always preserve unrelated project data unless the user clearly asked to remove or replace it.',
    'When the request is ambiguous, make the smallest safe change that still satisfies the request.',
    'If the user is asking a question instead of requesting a change, keep updatedProject unchanged and answer in assistantMessage.',
    'Return valid JSON only.',
    'Do not include markdown, code fences, or any extra text.',
    'The JSON must be an object with exactly these top-level keys: assistantMessage, changeSummary, updatedProject.',
    'assistantMessage must be a string.',
    'changeSummary must be an array of strings.',
    'updatedProject must be the full Entry project JSON object.',
    `Entry block catalog:\n${JSON.stringify(blockCatalog, null, 2)}`,
].join('\n\n');

const MAX_CONTEXT_MESSAGES = 12;

function extractOutputText(data: any) {
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const output = Array.isArray(data?.output) ? data.output : [];
    const text = output
        .flatMap((item: any) => {
            const content = Array.isArray(item?.content) ? item.content : [];
            return content.map((part: any) => {
                if (typeof part?.text === 'string') {
                    return part.text;
                }
                if (typeof part?.output_text === 'string') {
                    return part.output_text;
                }
                return '';
            });
        })
        .join('')
        .trim();

    if (!text) {
        throw new Error('OpenAI 응답에서 텍스트를 찾을 수 없습니다.');
    }

    return text;
}

function validateResponse(outputText: string): IAIProjectUpdateResponse {
    const parsed = JSON.parse(outputText);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('AI 응답 루트가 객체 JSON이 아닙니다.');
    }

    if (typeof parsed.assistantMessage !== 'string' || !parsed.assistantMessage.trim()) {
        throw new Error('AI 응답에 assistantMessage가 없습니다.');
    }

    if (!Array.isArray(parsed.changeSummary)) {
        throw new Error('AI 응답의 changeSummary가 배열이 아닙니다.');
    }

    if (
        !parsed.updatedProject ||
        typeof parsed.updatedProject !== 'object' ||
        Array.isArray(parsed.updatedProject)
    ) {
        throw new Error('AI 응답의 updatedProject가 객체가 아닙니다.');
    }

    if (!Array.isArray(parsed.updatedProject.objects)) {
        throw new Error('AI 응답의 updatedProject.objects가 배열이 아닙니다.');
    }

    return {
        assistantMessage: parsed.assistantMessage.trim(),
        changeSummary: parsed.changeSummary.filter((item: unknown): item is string => {
            return typeof item === 'string' && item.trim().length > 0;
        }),
        updatedProject: parsed.updatedProject,
    };
}

function buildConversationContext(messages: IAIChatMessage[]) {
    return messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((message) => {
            const prefix = message.role === 'user' ? 'User' : 'Assistant';
            const changeSummary =
                message.changeSummary && message.changeSummary.length ?
                    `\nChange summary:\n- ${message.changeSummary.join('\n- ')}` :
                    '';

            return `${prefix}: ${message.content}${changeSummary}`;
        })
        .join('\n\n');
}

function getApproximateOutputTokens(data: any, outputText: string) {
    const usageOutputTokens = Number(data?.usage?.output_tokens);
    if (!Number.isNaN(usageOutputTokens) && usageOutputTokens > 0) {
        return usageOutputTokens;
    }

    return Math.ceil(outputText.length / 4);
}

function extractErrorMessage(error: unknown) {
    const axiosError = error as {
        isAxiosError?: boolean;
        response?: { data?: { error?: { message?: string }; message?: string } };
        message?: string;
    };

    if (axiosError?.isAxiosError) {
        const message =
            axiosError.response?.data?.error?.message ||
            axiosError.response?.data?.message ||
            axiosError.message;
        return message || 'OpenAI 요청에 실패했습니다.';
    }

    if (error instanceof Error) {
        return error.message;
    }

    return 'OpenAI 요청에 실패했습니다.';
}

export default class OpenAIProjectEditor {
    private static buildInput(request: IAIGenerateProjectRequest) {
        const conversationContext = buildConversationContext(request.messages);
        return [
            `Project name: ${request.projectName}`,
            conversationContext ? `Conversation history:\n${conversationContext}` : '',
            `Latest user request:\n${request.prompt.trim()}`,
            `Current project JSON:\n${JSON.stringify(request.currentProject, null, 2)}`,
        ]
            .filter(Boolean)
            .join('\n\n');
    }

    private static async requestProjectUpdate(
        request: IAIGenerateProjectRequest,
        retryCount = 0
    ): Promise<IAIProjectUpdateResponse> {
        const { settings } = request;
        const trimmedApiKey = settings.apiKey.trim();

        if (!trimmedApiKey) {
            throw new Error('OpenAI API Key를 입력해야 합니다.');
        }

        if (!request.prompt.trim()) {
            throw new Error('AI에게 보낼 요청을 입력해야 합니다.');
        }

        const response = await axios.post(
            'https://api.openai.com/v1/responses',
            {
                model: settings.model,
                instructions: SYSTEM_PROMPT,
                input: this.buildInput(request),
                store: false,
                max_output_tokens: settings.maxOutputTokens,
                ...(settings.model.startsWith('gpt-5') ?
                    {
                        reasoning: {
                            effort: 'low',
                        },
                    } :
                    {}),
                text: {
                    format: {
                        type: 'json_object',
                    },
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${trimmedApiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: 120000,
            }
        );

        const outputText = extractOutputText(response.data);
        const parsedResponse = validateResponse(outputText);
        const outputTokens = getApproximateOutputTokens(response.data, outputText);

        if (settings.minOutputTokens > 0 && outputTokens < settings.minOutputTokens) {
            if (retryCount < 1) {
                return this.requestProjectUpdate(request, retryCount + 1);
            }

            throw new Error(
                `응답 길이가 최소 토큰 기준(${settings.minOutputTokens})보다 짧습니다.`
            );
        }

        return {
            ...parsedResponse,
            usage: {
                inputTokens: Number(response.data?.usage?.input_tokens) || undefined,
                outputTokens,
                totalTokens: Number(response.data?.usage?.total_tokens) || undefined,
            },
        };
    }

    static async generateProjectUpdate(request: IAIGenerateProjectRequest) {
        try {
            return await this.requestProjectUpdate(request);
        } catch (error) {
            throw new Error(extractErrorMessage(error));
        }
    }
}
