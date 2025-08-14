/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  Session,
  Chat,
} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() isChatVisible = false;
  @state() chatHistory: ChatMessage[] = [];
  @state() chatInput = '';
  @state() isChatLoading = false;

  private client: GoogleGenAI;
  private session: Session;
  private chat: Chat;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
    }

    .chat-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 400px;
      max-width: 90vw;
      height: 60vh;
      background: rgba(20, 20, 30, 0.8);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 16px;
      z-index: 20;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: white;
      font-family: sans-serif;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    }

    .chat-header {
      padding: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }

    .chat-header h3 {
      margin: 0;
      font-size: 1.1em;
      font-weight: 600;
    }

    .chat-header button {
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
    }

    .chat-messages {
      flex-grow: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .message-bubble {
      padding: 10px 15px;
      border-radius: 18px;
      max-width: 85%;
      word-wrap: break-word;
      line-height: 1.4;
      font-size: 0.95em;
    }

    .user-message {
      background: #3b82f6;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }

    .model-message {
      background: rgba(255, 255, 255, 0.15);
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }

    .chat-form {
      display: flex;
      padding: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
      flex-shrink: 0;
    }

    .chat-form input {
      flex-grow: 1;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      color: white;
      padding: 10px;
      font-size: 1em;
      outline: none;
    }

    .chat-form input:focus {
      border-color: #3b82f6;
    }

    .chat-form button {
      background: #3b82f6;
      border: none;
      color: white;
      border-radius: 8px;
      padding: 10px 15px;
      margin-left: 10px;
      cursor: pointer;
      font-size: 1em;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .chat-form button:disabled {
      background: #555;
      cursor: not-allowed;
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
    this.initChat();
  }

  private initChat() {
    this.chat = this.client.chats.create({
      model: 'gemini-2.5-flash',
    });
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}},
            // languageCode: 'en-GB'
          },
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Capturing PCM chunks.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  private toggleChat() {
    this.isChatVisible = !this.isChatVisible;
  }

  private handleChatInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this.chatInput = input.value;
  }

  private async handleChatSubmit(e: Event) {
    e.preventDefault();
    if (this.isChatLoading || !this.chatInput.trim()) return;

    const userInput = this.chatInput.trim();
    this.chatInput = '';
    this.isChatLoading = true;
    this.chatHistory = [...this.chatHistory, {role: 'user', text: userInput}];

    try {
      const stream = await this.chat.sendMessageStream({message: userInput});

      this.chatHistory = [...this.chatHistory, {role: 'model', text: ''}];
      for await (const chunk of stream) {
        const currentHistory = [...this.chatHistory];
        const lastMessage = currentHistory[currentHistory.length - 1];
        lastMessage.text += chunk.text;
        this.chatHistory = currentHistory;
      }
    } catch (err) {
      console.error('Chat error:', err);
      const newHistory = [...this.chatHistory];
      const lastMessage = newHistory[newHistory.length - 1];
      if (lastMessage.role === 'model' && lastMessage.text === '') {
        lastMessage.text = 'Sorry, I ran into an error.';
      } else {
        newHistory.push({role: 'model', text: 'Sorry, I ran into an error.'});
      }
      this.chatHistory = newHistory;
    } finally {
      this.isChatLoading = false;
    }
  }

  private renderChatPanel() {
    return html`
      <div class="chat-panel">
        <div class="chat-header">
          <h3>Gemini Chat</h3>
          <button @click=${this.toggleChat}>&times;</button>
        </div>
        <div
          class="chat-messages"
          @updated=${() => {
            this.shadowRoot?.querySelector('.chat-messages')?.scrollTo({
              top: this.shadowRoot?.querySelector('.chat-messages')
                .scrollHeight,
              behavior: 'smooth',
            });
          }}>
          ${this.chatHistory.map(
            (msg) => html`
              <div class="message-bubble ${msg.role}-message">${msg.text}</div>
            `,
          )}
          ${this.isChatLoading &&
          this.chatHistory[this.chatHistory.length - 1]?.role === 'user'
            ? html`<div class="message-bubble model-message">...</div>`
            : ''}
        </div>
        <form class="chat-form" @submit=${this.handleChatSubmit}>
          <input
            type="text"
            .value=${this.chatInput}
            @input=${this.handleChatInput}
            placeholder="Type a message..."
            ?disabled=${this.isChatLoading}
            autocomplete="off" />
          <button type="submit" ?disabled=${this.isChatLoading}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#ffffff">
              <path d="M120-160v-240l320-80-320-80v-240l760 320-760 320Z" />
            </svg>
          </button>
        </form>
      </div>
    `;
  }

  render() {
    return html`
      <div>
        <div class="controls">
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="chatButton"
            @click=${this.toggleChat}
            title="Open Chat">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M800-240v-240q0-100-70-170t-170-70H320q-100 0-170 70T80-560v320h120v-160h400v160h200Zm-320-80H240v-160q0-33 23.5-56.5T320-560h240q33 0 56.5 23.5T640-480v160Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#000000"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="0" y="0" width="100" height="100" rx="15" />
            </svg>
          </button>
        </div>

        <div id="status">${this.error}</div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
        ${this.isChatVisible ? this.renderChatPanel() : ''}
      </div>
    `;
  }
}