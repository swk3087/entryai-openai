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
    'Important: every object.script and function.content value must stay a serialized JSON string, not a raw array or object.',
    'Each script/content string must JSON.parse to an array of threads.',
    'Each thread must be an array of block objects.',
    'Each block object must keep its nested statements as an array of threads, where each statement item is again an array of block objects.',
    'If you are not editing a script/content field, copy the existing string exactly.',
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

function isObjectRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateBlockThread(thread: unknown, path: string) {
    if (!Array.isArray(thread)) {
        throw new Error(`${path}는 블록 배열(thread)이어야 합니다.`);
    }

    thread.forEach((block, index) => {
        const blockPath = `${path}[${index}]`;
        if (!isObjectRecord(block)) {
            throw new Error(`${blockPath}는 블록 객체여야 합니다.`);
        }

        if (typeof block.id !== 'string' || !block.id.trim()) {
            throw new Error(`${blockPath}.id는 비어 있지 않은 문자열이어야 합니다.`);
        }

        if (typeof block.type !== 'string' || !block.type.trim()) {
            throw new Error(`${blockPath}.type은 비어 있지 않은 문자열이어야 합니다.`);
        }

        if ('params' in block && !Array.isArray(block.params)) {
            throw new Error(`${blockPath}.params는 배열이어야 합니다.`);
        }

        if ('extensions' in block && !Array.isArray(block.extensions)) {
            throw new Error(`${blockPath}.extensions는 배열이어야 합니다.`);
        }

        if (!Array.isArray(block.statements)) {
            throw new Error(`${blockPath}.statements는 배열이어야 합니다.`);
        }

        block.statements.forEach((statementThread: unknown, statementIndex: number) => {
            validateBlockThread(statementThread, `${blockPath}.statements[${statementIndex}]`);
        });
    });
}

function validateSerializedScript(
    scriptValue: unknown,
    path: string,
    options?: { allowEmpty?: boolean }
) {
    if (typeof scriptValue !== 'string') {
        throw new Error(`${path}는 문자열이어야 합니다.`);
    }

    const trimmedValue = scriptValue.trim();
    if (!trimmedValue) {
        if (options?.allowEmpty) {
            return;
        }
        throw new Error(`${path}가 비어 있습니다.`);
    }

    let parsedScript;
    try {
        parsedScript = JSON.parse(trimmedValue);
    } catch (error) {
        throw new Error(`${path}는 JSON 문자열이어야 합니다.`);
    }

    if (!Array.isArray(parsedScript)) {
        throw new Error(`${path}는 스레드 배열(JSON array)이어야 합니다.`);
    }

    parsedScript.forEach((thread, index) => {
        validateBlockThread(thread, `${path}[${index}]`);
    });
}

function validateProjectStructure(project: Record<string, any>) {
    if (!Array.isArray(project.objects)) {
        throw new Error('AI 응답의 updatedProject.objects가 배열이 아닙니다.');
    }

    project.objects.forEach((object, index) => {
        const objectPath = `updatedProject.objects[${index}]`;
        if (!isObjectRecord(object)) {
            throw new Error(`${objectPath}는 객체여야 합니다.`);
        }

        validateSerializedScript(object.script, `${objectPath}.script`, {
            allowEmpty: false,
        });
    });

    if ('functions' in project && !Array.isArray(project.functions)) {
        throw new Error('AI 응답의 updatedProject.functions가 배열이 아닙니다.');
    }

    const functions = Array.isArray(project.functions) ? project.functions : [];
    functions.forEach((func, index) => {
        const functionPath = `updatedProject.functions[${index}]`;
        if (!isObjectRecord(func)) {
            throw new Error(`${functionPath}는 객체여야 합니다.`);
        }

        validateSerializedScript(func.content, `${functionPath}.content`, {
            allowEmpty: false,
        });
    });
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

    validateProjectStructure(parsed.updatedProject);

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
    private static buildInput(request: IAIGenerateProjectRequest, validationFeedback?: string) {
        const conversationContext = buildConversationContext(request.messages);
        return [
            `Project name: ${request.projectName}`,
            conversationContext ? `Conversation history:\n${conversationContext}` : '',
            `Latest user request:\n${request.prompt.trim()}`,
            validationFeedback ?
                `Previous response validation error:\n${validationFeedback}\nFix the response and return a fully corrected project.` :
                '',
            `Current project JSON:\n${JSON.stringify(request.currentProject, null, 2)}`,
        ]
            .filter(Boolean)
            .join('\n\n');
    }

    private static async requestProjectUpdate(
        request: IAIGenerateProjectRequest,
        retryCount = 0,
        validationFeedback?: string
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
                input: this.buildInput(request, validationFeedback),
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
        let parsedResponse: IAIProjectUpdateResponse;
        try {
            parsedResponse = validateResponse(outputText);
        } catch (error) {
            if (retryCount < 1 && error instanceof Error) {
                return this.requestProjectUpdate(request, retryCount + 1, error.message);
            }

            throw error;
        }
        const outputTokens = getApproximateOutputTokens(response.data, outputText);

        if (settings.minOutputTokens > 0 && outputTokens < settings.minOutputTokens) {
            if (retryCount < 1) {
                return this.requestProjectUpdate(
                    request,
                    retryCount + 1,
                    'Previous response was too short. Return a fuller but still valid project update.'
                );
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
