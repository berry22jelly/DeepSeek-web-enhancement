// ==UserScript==
// @name         deepseek web朗读器
// @namespace    http://tampermonkey.net/
// @version      2026-04-02
// @description  为你朗读deepseek生成的文本，点击油猴菜单中的show即可看到朗读器。滚动到想要听的消息处，点击朗读。
// @author       berry22jelly
// @license      MIT
// @source       https://github.com/berry22jelly/DeepSeek-web-enhancement/
// @match        https://chat.deepseek.com/**
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';
    function findClosestToViewport(elements) {
        let closestElement = null;
        let closestDistance = Infinity;

        elements.forEach(el => {
            const rect = el.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // 计算元素中心点到视口中心点的距离
            const elementCenter = rect.top + rect.height / 2;
            const viewportCenter = viewportHeight / 2;
            const distance = Math.abs(elementCenter - viewportCenter);

            if (distance < closestDistance) {
                closestDistance = distance;
                closestElement = el;
            }
        });

        return closestElement;
    }
    /**
 * SpeechWidgetUI
 */
    class SpeechWidgetUI {
        constructor(containerSelector, options = {}) {
            if (!('speechSynthesis' in window)) {
                alert("您的浏览器不支持语音合成 API");
                return;
            }

            this.synth = window.speechSynthesis;
            this.voices = [];
            this.currentUtterance = null;

            // 默认配置
            this.config = {
                themeColor: options.themeColor || '#007bff',
                defaultRate: options.defaultRate || 1,
                defaultPitch: options.defaultPitch || 1,
                defaultVolume: options.defaultVolume || 1,
                defaultLang: options.defaultLang || 'zh-CN',
                placeholderText: options.placeholderText || '在此输入要朗读的文字...',
                width: options.width || '100%',
                maxHeight: options.maxHeight || '300px'
            };

            // 状态
            this.isSpeaking = false;
            this.isPaused = false;

            // 1. 获取容器
            this.container = document.querySelector(containerSelector);
            if (!this.container) {
                throw new Error(`未找到容器：${containerSelector}`);
            }

            this._createDOM();

            this._initVoices();

            // 绑定事件
            this._bindEvents();
            this._setupSynthEvents();
        }

        /**
     * 初始化声音列表
     */
        _initVoices() {
            const loadVoices = () => {
                this.voices = this.synth.getVoices().sort((a, b) => {
                    const aname = a.name.toUpperCase();
                    const bname = b.name.toUpperCase();
                    if (aname < bname) return -1;
                    else if (aname === bname) return 0;
                    else return +1;
                });
                this._populateVoiceSelect();
            };

            // 立即尝试加载一次
            loadVoices();

            // 监听变化（处理异步加载）
            if (this.synth.onvoiceschanged !== undefined) {
                this.synth.onvoiceschanged = loadVoices;
            }
        }

        /**
     * 创建 DOM 结构
     */
        _createDOM() {

            // 主容器
            this.widgetEl = document.createElement('div');
            this.widgetEl.className = 'sw-widget-container';
            this.widgetEl.style.cssText = `
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            background: #fff;
            box-shadow: 0 2px 10px rgba(0,0,0,0.05);
            width: ${this.config.width};
            box-sizing: border-box;
            color: #333;
        `;

            // 标题
            const header = document.createElement('div');
            header.style.cssText = `display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;`;
            header.innerHTML = `<h3 style="margin:0; font-size: 16px; color:${this.config.themeColor}">🔊 朗读助手</h3>`;
            this.widgetEl.appendChild(header);

            // 文本域
            //         this.textArea = document.createElement('textarea');
            //         this.textArea.className = 'sw-textarea';
            //         this.textArea.placeholder = this.config.placeholderText;
            //         this.textArea.rows = 4;
            //         this.textArea.style.cssText = `
            //             width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 4px;
            //             resize: vertical; font-size: 14px; margin-bottom: 15px; box-sizing: border-box; outline: none;
            //         `;
            //         this.textArea.onfocus = () => this.textArea.style.borderColor = this.config.themeColor;
            //         this.textArea.onblur = () => this.textArea.style.borderColor = '#ccc';
            //         this.widgetEl.appendChild(this.textArea);

            // 控制面板
            const controlsGrid = document.createElement('div');
            controlsGrid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px; margin-bottom: 20px; padding: 15px; background: #f9f9f9; border-radius: 6px;`;

            const createSlider = (label, min, max, step, value, key) => {
                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';
                const labelEl = document.createElement('label');
                labelEl.textContent = label;
                labelEl.style.fontSize = '12px';
                labelEl.style.marginBottom = '5px';
                labelEl.style.fontWeight = 'bold';
                const input = document.createElement('input');
                input.type = 'range';
                input.min = min; input.max = max; input.step = step; input.value = value;
                input.dataset.key = key;
                input.style.width = '100%';
                input.style.accentColor = this.config.themeColor;
                wrapper.appendChild(labelEl);
                wrapper.appendChild(input);
                return { wrapper, input };
            };

            const rateCtrl = createSlider('语速', 0.5, 2, 0.1, this.config.defaultRate, 'rate');
            const pitchCtrl = createSlider('音调', 0, 2, 0.1, this.config.defaultPitch, 'pitch');
            const volCtrl = createSlider('音量', 0, 1, 0.1, this.config.defaultVolume, 'volume');

            controlsGrid.appendChild(rateCtrl.wrapper);
            controlsGrid.appendChild(pitchCtrl.wrapper);
            controlsGrid.appendChild(volCtrl.wrapper);
            this.inputs = { rate: rateCtrl.input, pitch: pitchCtrl.input, volume: volCtrl.input };
            this.widgetEl.appendChild(controlsGrid);

            // 底部行
            const bottomRow = document.createElement('div');
            bottomRow.style.cssText = `display: flex; flex-wrap: wrap; gap: 10px; align-items: center;`;

            // 声音选择器 (关键：这里创建了 this.voiceSelect)
            const selectWrapper = document.createElement('div');
            selectWrapper.style.flex = '1 1 200px';
            const selectLabel = document.createElement('label');
            selectLabel.textContent = '声音：';
            selectLabel.style.fontSize = '13px';
            selectLabel.style.marginRight = '5px';

            this.voiceSelect = document.createElement('select'); // <--- 这里定义了属性
            this.voiceSelect.style.cssText = `width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; background: white;`;

            selectWrapper.appendChild(selectLabel);
            selectWrapper.appendChild(this.voiceSelect);
            bottomRow.appendChild(selectWrapper);

            // 按钮
            const btnGroup = document.createElement('div');
            btnGroup.style.cssText = `display: flex; gap: 8px;`;
            const createBtn = (text, actionClass, icon = '') => {
                const btn = document.createElement('button');
                btn.textContent = `${icon} ${text}`;
                btn.className = `sw-btn ${actionClass}`;
                btn.style.cssText = `padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; transition: opacity 0.2s; color: white; background-color: ${actionClass === 'sw-btn-play' ? this.config.themeColor : '#6c757d'};`;
                btn.onmouseover = () => btn.style.opacity = '0.9';
                btn.onmouseout = () => btn.style.opacity = '1';
                return btn;
            };
            this.btnPlay = createBtn('播放', 'sw-btn-play', '▶');
            this.btnPause = createBtn('暂停', 'sw-btn-pause', '⏸');
            this.btnStop = createBtn('停止', 'sw-btn-stop', '⏹');
            this.btnPause.style.backgroundColor = '#ffc107';
            this.btnPause.style.color = '#333';

            btnGroup.appendChild(this.btnPlay);
            btnGroup.appendChild(this.btnPause);
            btnGroup.appendChild(this.btnStop);
            bottomRow.appendChild(btnGroup);
            this.widgetEl.appendChild(bottomRow);

            // 状态栏
            this.statusBar = document.createElement('div');
            this.statusBar.style.cssText = `margin-top: 10px; font-size: 12px; color: #666; text-align: right; height: 18px;`;
            this.statusBar.textContent = '就绪';
            this.widgetEl.appendChild(this.statusBar);

            // 挂载
            this.container.appendChild(this.widgetEl);
        }

        /**
     * 填充声音下拉框 (增加了防御性检查)
     */
        _populateVoiceSelect() {
            // 【修复点 3】防御性检查：如果 DOM 还没创建好，直接返回
            if (!this.voiceSelect) {
                console.warn('SpeechWidgetUI: voiceSelect element not ready yet.');
                return;
            }

            this.voiceSelect.innerHTML = '';

            if (this.voices.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = '正在加载声音列表...';
                opt.disabled = true;
                this.voiceSelect.appendChild(opt);
                return;
            }

            let selectedIndex = 0;

            this.voices.forEach((voice, index) => {
                const opt = document.createElement('option');
                opt.value = index;
                opt.textContent = `${voice.name} (${voice.lang})`;

                if (voice.lang.startsWith(this.config.defaultLang.split('-')[0])) {
                    selectedIndex = index;
                }
                if (voice.lang === this.config.defaultLang) {
                    selectedIndex = index;
                }
                this.voiceSelect.appendChild(opt);
            });

            this.voiceSelect.selectedIndex = selectedIndex;
        }

        _bindEvents() {
            this.btnPlay.addEventListener('click', () => {
                const text = findClosestToViewport(document.querySelectorAll(".ds-markdown")).innerText;
                if (!text) {
                    this._setStatus('未找到文字', 'red');
                    return;
                }
                if (this.isPaused) {
                    this.resume();
                    return;
                }
                this.speak(text);
            });

            this.btnPause.addEventListener('click', () => {
                if (!this.isSpeaking && !this.isPaused) return;
                if (this.isPaused) this.resume();
                else this.pause();
            });

            this.btnStop.addEventListener('click', () => this.stop());
        }

        _setupSynthEvents() {
            this.synth.onstart = () => {
                this.isSpeaking = true;
                this.isPaused = false;
                this._setStatus('正在播放...', this.config.themeColor);
                this.btnPlay.disabled = true;
                this.btnPlay.style.opacity = '0.5';
            };
            this.synth.onend = () => {
                this.isSpeaking = false;
                this.isPaused = false;
                this._setStatus('播放完毕', '#28a745');
                this.btnPlay.disabled = false;
                this.btnPlay.style.opacity = '1';
            };
            this.synth.onerror = () => {
                this.isSpeaking = false;
                this.isPaused = false;
                this._setStatus('发生错误', 'red');
                this.btnPlay.disabled = false;
                this.btnPlay.style.opacity = '1';
            };
            this.synth.onpause = () => {
                this.isPaused = true;
                this._setStatus('已暂停', '#ffc107');
                this.btnPause.textContent = '▶ 继续';
            };
            this.synth.onresume = () => {
                this.isPaused = false;
                this._setStatus('正在播放...', this.config.themeColor);
                this.btnPause.textContent = '⏸ 暂停';
            };
        }

        speak(text) {
            this.stop();
            const utterance = new SpeechSynthesisUtterance(text);
            const selectedIdx = this.voiceSelect.value;
            if (selectedIdx && this.voices[selectedIdx]) {
                utterance.voice = this.voices[selectedIdx];
            }
            utterance.rate = parseFloat(this.inputs.rate.value);
            utterance.pitch = parseFloat(this.inputs.pitch.value);
            utterance.volume = parseFloat(this.inputs.volume.value);
            this.currentUtterance = utterance;
            this.synth.speak(utterance);
        }

        pause() { if (this.synth.speaking && !this.synth.paused) this.synth.pause(); }
        resume() { if (this.synth.paused) this.synth.resume(); }

        stop() {
            this.synth.cancel();
            this.isSpeaking = false;
            this.isPaused = false;
            this._setStatus('已停止', '#666');
            this.btnPlay.disabled = false;
            this.btnPlay.style.opacity = '1';
            this.btnPause.textContent = '⏸ 暂停';
        }

        _setStatus(msg, color) {
            if (this.statusBar) {
                this.statusBar.textContent = msg;
                this.statusBar.style.color = color || '#666';
            }
        }

        setText(text) { if (this.textArea) this.textArea.value = text; }
        getText() { return this.textArea ? this.textArea.value : ''; }

        destroy() {
            this.stop();
            if (this.widgetEl && this.widgetEl.parentNode) {
                this.widgetEl.parentNode.removeChild(this.widgetEl);
            }
        }
    }

    GM_registerMenuCommand("show", () => {

        function init(){
            // 创建 div 元素
            const fixedDiv = document.createElement('div');

            // 设置样式
            fixedDiv.style.cssText = `
  position: fixed;
  bottom: 5px;
  right: 5px;
  width: 190px;
  height: 200px;
  background-color: #007bff;
  color: white;
  border-radius: 5px;
  padding: 3px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  z-index: 9999;
  font-family: Arial, sans-serif;
  cursor: pointer;
  transition: all 0.3s ease;
  overflow-y: scroll;
`;

        // 添加内容
        fixedDiv.innerHTML = `
  <div id="voice-reader"></div>
  <button onclick="this.parentElement.remove()">关闭</button>
`;

        document.body.appendChild(fixedDiv);

        // 实例化组件
        // 第一个参数是容器的 CSS 选择器
        // 第二个参数是可选配置对象
        const ttsWidget = new SpeechWidgetUI('#voice-reader', {
            themeColor: '#4CAF50',       // 自定义主题色 (绿色)
            defaultRate: 1.0,            // 默认语速
            defaultPitch: 1.0,           // 默认音调
            defaultVolume: 1.0,          // 默认音量
            defaultLang: 'zh-CN',        // 优先选择的语言
            width: '100%'                // 组件宽度
        });


        // 如果需要外部控制（例如点击页面其他按钮触发）
        // document.getElementById('externalBtn').addEventListener('click', () => {
        //     ttsWidget.speak(ttsWidget.getText());
        // });

    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(init, 1000); // 延迟1秒初始化
        });
    } else {
        setTimeout(init, 1000); // 延迟1秒初始化
    }
});
                       })();
