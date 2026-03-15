import React, { ChangeEvent, Component, KeyboardEvent, createRef } from 'react';
import './AIPanel.scss';
import IpcRendererHelper from '../helper/ipcRendererHelper';
import {
    IAIChatMessage,
    IAIConversation,
    IAIPanelSettings,
    IAIProjectUpdateResponse,
} from '../../common/ai';

const DEFAULT_SETTINGS: IAIPanelSettings = {
    apiKey: '',
    model: 'gpt-5.4',
    maxOutputTokens: 12000,
    minOutputTokens: 100,
};

interface IProps {
    projectKey: string;
    projectName: string;
    isGenerating: boolean;
    onClose: () => void;
    onApplyProject: (response: IAIProjectUpdateResponse) => Promise<void>;
    onGenerationStateChange: (isGenerating: boolean) => void;
}

interface IState {
    settings: IAIPanelSettings;
    messages: IAIChatMessage[];
    prompt: string;
    storagePath: string;
    isLoadingState: boolean;
}

export default class AIPanel extends Component<IProps, IState> {
    private messageEndRef = createRef<HTMLDivElement>();

    state: IState = {
        settings: DEFAULT_SETTINGS,
        messages: [],
        prompt: '',
        storagePath: '',
        isLoadingState: false,
    };

    async componentDidMount() {
        await this.loadPanelState(this.props.projectKey);
    }

    async componentDidUpdate(prevProps: Readonly<IProps>, prevState: Readonly<IState>) {
        if (prevProps.projectKey !== this.props.projectKey) {
            await this.loadPanelState(this.props.projectKey);
        }

        if (
            prevState.messages !== this.state.messages ||
            prevProps.isGenerating !== this.props.isGenerating
        ) {
            this.scrollToBottom();
        }
    }

    createMessage(
        role: IAIChatMessage['role'],
        content: string,
        changeSummary?: string[]
    ): IAIChatMessage {
        return {
            id: `${role}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
            role,
            content,
            createdAt: new Date().toISOString(),
            ...(changeSummary && changeSummary.length ? { changeSummary } : {}),
        };
    }

    async loadPanelState(projectKey: string) {
        if (!projectKey) {
            this.setState({
                settings: DEFAULT_SETTINGS,
                messages: [],
                storagePath: '',
            });
            return;
        }

        const panelState = await IpcRendererHelper.getAIPanelState(projectKey);
        this.setState({
            settings: panelState.settings,
            messages: panelState.conversation.messages || [],
            storagePath: panelState.storagePath,
        });
    }

    async persistConversation(messages: IAIChatMessage[]) {
        const { projectKey, projectName } = this.props;
        if (!projectKey) {
            return;
        }

        const conversation: IAIConversation = {
            messages,
            projectName,
            updatedAt: new Date().toISOString(),
        };
        await IpcRendererHelper.saveAIConversation(projectKey, conversation);
    }

    scrollToBottom() {
        this.messageEndRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
        });
    }

    handleSettingsChange = <K extends keyof IAIPanelSettings>(
        key: K,
        value: IAIPanelSettings[K] | string
    ) => {
        const nextSettings = {
            ...this.state.settings,
            [key]:
                key === 'apiKey' || key === 'model' ?
                    value :
                    Math.max(0, Number(value) || 0),
        } as IAIPanelSettings;

        this.setState({
            settings: nextSettings,
        });
        IpcRendererHelper.saveAISettings(nextSettings).catch((error) => {
            console.warn('Failed to save AI settings:', error);
        });
    };

    handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
        this.setState({
            prompt: event.target.value,
        });
    };

    handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            void this.handleSend();
        }
    };

    handleSend = async () => {
        const { prompt, messages, settings, isLoadingState } = this.state;
        const trimmedPrompt = prompt.trim();

        if (!trimmedPrompt || isLoadingState || !this.props.projectKey) {
            return;
        }

        const userMessage = this.createMessage('user', trimmedPrompt);
        const nextMessages = [...messages, userMessage];

        this.setState({
            messages: nextMessages,
            prompt: '',
            isLoadingState: true,
        });
        await this.persistConversation(nextMessages);
        this.props.onGenerationStateChange(true);

        try {
            const currentProject = Entry.exportProject();
            currentProject.name = this.props.projectName;

            const response = await IpcRendererHelper.generateAIProjectUpdate({
                projectName: this.props.projectName,
                prompt: trimmedPrompt,
                currentProject,
                messages: nextMessages,
                settings,
            });

            await this.props.onApplyProject(response);

            const assistantMessage = this.createMessage(
                'assistant',
                response.assistantMessage,
                response.changeSummary
            );
            const updatedMessages = [...nextMessages, assistantMessage];

            this.setState({
                messages: updatedMessages,
            });
            await this.persistConversation(updatedMessages);
        } catch (error) {
            const errorMessage = this.createMessage(
                'error',
                error instanceof Error ? error.message : 'AI 요청에 실패했습니다.'
            );
            const updatedMessages = [...nextMessages, errorMessage];

            this.setState({
                messages: updatedMessages,
            });
            await this.persistConversation(updatedMessages);
        } finally {
            this.setState({
                isLoadingState: false,
            });
            this.props.onGenerationStateChange(false);
        }
    };

    renderMessage(message: IAIChatMessage) {
        const timeText = new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });

        return (
            <div key={message.id} className={`ai_panel_message ${message.role}`}>
                <div className={'ai_panel_message_bubble'}>
                    <p>{message.content}</p>
                    {message.changeSummary && message.changeSummary.length > 0 && (
                        <ul className={'ai_panel_message_summary'}>
                            {message.changeSummary.map((item, index) => (
                                <li key={`${message.id}_${index}`}>{item}</li>
                            ))}
                        </ul>
                    )}
                </div>
                <span className={'ai_panel_message_time'}>{timeText}</span>
            </div>
        );
    }

    render() {
        const { onClose, projectName, isGenerating } = this.props;
        const { settings, messages, prompt, storagePath, isLoadingState } = this.state;
        const isBusy = isGenerating || isLoadingState;

        return (
            <aside className={'ai_panel'}>
                <div className={'ai_panel_header'}>
                    <div>
                        <strong>AI 편집기</strong>
                        <span className={'ai_panel_project'}>{projectName}</span>
                    </div>
                    <button type="button" className={'ai_panel_close'} onClick={onClose}>
                        닫기
                    </button>
                </div>

                <div className={'ai_panel_settings'}>
                    <label>
                        <span>API Key</span>
                        <input
                            type="password"
                            value={settings.apiKey}
                            onChange={({ target }) =>
                                this.handleSettingsChange('apiKey', target.value)
                            }
                            placeholder="sk-..."
                            disabled={isBusy}
                        />
                    </label>
                    <label>
                        <span>Model</span>
                        <input
                            type="text"
                            value={settings.model}
                            onChange={({ target }) =>
                                this.handleSettingsChange('model', target.value)
                            }
                            placeholder="gpt-5.4"
                            disabled={isBusy}
                        />
                    </label>
                    <label>
                        <span>Max Tokens</span>
                        <input
                            type="number"
                            min={256}
                            value={settings.maxOutputTokens}
                            onChange={({ target }) =>
                                this.handleSettingsChange('maxOutputTokens', target.value)
                            }
                            disabled={isBusy}
                        />
                    </label>
                    <label>
                        <span>Min Tokens</span>
                        <input
                            type="number"
                            min={0}
                            value={settings.minOutputTokens}
                            onChange={({ target }) =>
                                this.handleSettingsChange('minOutputTokens', target.value)
                            }
                            disabled={isBusy}
                        />
                    </label>
                </div>

                <div className={'ai_panel_hint'}>
                    대화 기록은 작품별로 저장되고, 다시 시작해도 같은 작품에서 이어집니다.
                </div>

                <div className={'ai_panel_messages'}>
                    {messages.length === 0 ? (
                        <div className={'ai_panel_empty'}>
                            현재 작품에 대한 요청을 입력하면 변경 내용과 대화가 여기에 저장됩니다.
                        </div>
                    ) : (
                        messages.map((message) => this.renderMessage(message))
                    )}
                    <div ref={this.messageEndRef} />
                </div>

                <div className={'ai_panel_footer'}>
                    <textarea
                        value={prompt}
                        onChange={this.handlePromptChange}
                        onKeyDown={this.handlePromptKeyDown}
                        placeholder="예: 플레이어 스프라이트를 추가하고 화살표 키로 움직이게 만들어줘"
                        disabled={isBusy}
                    />
                    <div className={'ai_panel_actions'}>
                        <span className={'ai_panel_storage'} title={storagePath}>
                            저장: {storagePath || '준비 중'}
                        </span>
                        <button
                            type="button"
                            className={'ai_panel_send'}
                            onClick={() => {
                                void this.handleSend();
                            }}
                            disabled={!prompt.trim() || isBusy}
                        >
                            {isBusy ? '생성 중...' : '보내기'}
                        </button>
                    </div>
                </div>
            </aside>
        );
    }
}
