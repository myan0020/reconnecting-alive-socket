export interface ReconnectingAliveSocketEvent extends CustomEvent {
  isReconnect?: boolean;
  code?: number;
  reason?: string;
  wasClean?: boolean;
  data?: unknown;
}

class ReconnectingAliveSocket {
  static CONNECTING = WebSocket.CONNECTING;
  static OPEN = WebSocket.OPEN;
  static CLOSING = WebSocket.CLOSING;
  static CLOSED = WebSocket.CLOSED;

  url: string;
  maxReconnectAttempts = 1000;
  readyState = WebSocket.CONNECTING;
  reconnectAttempts = 0; // The number of attempted reconnects since starting, or the last successful connection
  reconnectInterval = 1000; // The number of milliseconds to delay before attempting to reconnect
  maxReconnectInterval = 30 * 1000; // The maximum number of milliseconds to delay a reconnection attempt
  reconnectDecay = 1.5; // The rate of increase of the reconnect delay. Allows reconnect attempts to back off when problems persist
  resendInterval = 1000;
  resendDecay = 1.5;
  maxResendInterval = 5 * 1000;

  private ws: WebSocket | undefined;
  private forcedClose = false;
  private timedOut = false;
  private eventTarget: EventTarget = document.createElement("div");
  private generateEvent(eventName: string): ReconnectingAliveSocketEvent {
    const event = new CustomEvent(eventName) as ReconnectingAliveSocketEvent;
    return event;
  }
  private attemptToSend(
    data: string | ArrayBuffer | Blob | ArrayBufferView,
    resendAttempts: number
  ): void {
    console.debug(
      "ReconnectingWebSocket",
      "attempt-send",
      data,
      `resendAttempts(${resendAttempts})`
    );

    if (!this.ws || this.ws.readyState !== 1) {
      const timeInterval = Math.min(
        this.resendInterval * Math.pow(this.resendDecay, resendAttempts),
        this.maxResendInterval
      );
      setTimeout(() => {
        this.attemptToSend(data, resendAttempts + 1);
      }, timeInterval);
      return;
    }

    this.ws.send(data);
    console.debug(
      "ReconnectingWebSocket",
      "attempt-send-success",
      data,
      this.ws,
      `resendAttempts(${resendAttempts})`
    );
  }

  constructor(url: string) {
    this.url = url;

    // The maximum time in milliseconds to wait for a connection to succeed before closing and retrying
    // this.openningTimeoutInterval = 2000;

    // Wire up "on*" properties as event handlers
    this.eventTarget.addEventListener("open", (event) => {
      this.onopen(event);
    });
    this.eventTarget.addEventListener("close", (event) => {
      this.onclose(event);
    });
    this.eventTarget.addEventListener("connecting", (event) => {
      this.onconnecting(event);
    });
    this.eventTarget.addEventListener("message", (event) => {
      this.onmessage(event);
    });
    this.eventTarget.addEventListener("error", (event) => {
      this.onerror(event);
    });
    // Expose the API required by EventTarget
    this.addEventListener = this.eventTarget.addEventListener.bind(this.eventTarget);
    this.removeEventListener = this.eventTarget.removeEventListener.bind(this.eventTarget);
    this.dispatchEvent = this.eventTarget.dispatchEvent.bind(this.eventTarget);

    this.open(false);
  }

  /**
   * An event listener to be called when the WebSocket connection's readyState changes to OPEN;
   * this indicates that the connection is ready to send and receive data.
   */
  onopen(event: Event) {}
  /** An event listener to be called when the WebSocket connection's readyState changes to CLOSED. */
  onclose(event: Event) {}
  /** An event listener to be called when a connection begins being attempted. */
  onconnecting(event: Event) {}
  /** An event listener to be called when a message is received from the server. */
  onmessage(event: Event) {}
  /** An event listener to be called when an error occurs. */
  onerror(event: Event) {}

  addEventListener(type: string, callback: EventListener, options?: boolean | AddEventListenerOptions | undefined): void {}
  removeEventListener(type: string, callback: EventListener, options?: boolean | AddEventListenerOptions | undefined): void {}
  dispatchEvent(event: Event) {}

  open(isReconnectAttempt: boolean) {
    const that: ReconnectingAliveSocket = this;

    this.ws = new WebSocket(this.url);

    if (isReconnectAttempt) {
      if (this.maxReconnectAttempts && this.reconnectAttempts > this.maxReconnectAttempts) {
        return;
      }
    } else {
      this.eventTarget.dispatchEvent(this.generateEvent("connecting"));
      this.reconnectAttempts = 0;
    }

    console.debug("ReconnectingWebSocket", "attempt-connect", this.url);

    this.ws.onopen = (event) => {
      console.debug("ReconnectingWebSocket", "onopen", that.url);

      that.readyState = WebSocket.OPEN;
      that.reconnectAttempts = 0;

      const customEvent = that.generateEvent("open");
      customEvent.isReconnect = isReconnectAttempt;
      isReconnectAttempt = false;
      that.eventTarget.dispatchEvent(customEvent);
    };

    this.ws.onclose = (event) => {
      that.ws = undefined;

      if (that.forcedClose) {
        that.readyState = WebSocket.CLOSED;

        const customCloseEvent = that.generateEvent("close");
        customCloseEvent.code = event.code;
        customCloseEvent.reason = event.reason;
        customCloseEvent.wasClean = event.wasClean;
        that.eventTarget.dispatchEvent(customCloseEvent);

        const customRemoveEvent = that.generateEvent("remove");
        that.eventTarget.dispatchEvent(customRemoveEvent);
      } else {
        that.readyState = WebSocket.CONNECTING;

        const customEvent = that.generateEvent("connecting");
        customEvent.code = event.code;
        customEvent.reason = event.reason;
        customEvent.wasClean = event.wasClean;
        that.eventTarget.dispatchEvent(customEvent);

        if (!isReconnectAttempt && !that.timedOut) {
          console.debug("ReconnectingWebSocket", "onclose", that.url);

          const customEvent = that.generateEvent("close");
          customEvent.code = event.code;
          customEvent.reason = event.reason;
          customEvent.wasClean = event.wasClean;
          that.eventTarget.dispatchEvent(customEvent);
        }

        const timeInterval = Math.min(
          that.reconnectInterval * Math.pow(that.reconnectDecay, that.reconnectAttempts),
          that.maxReconnectInterval
        );
        setTimeout(function () {
          that.reconnectAttempts++;
          that.open(true);
        }, timeInterval);
      }
    };

    this.ws.onmessage = (event) => {
      console.debug("ReconnectingWebSocket", "onmessage", that.url, event.data);

      const customEvent = that.generateEvent("message");
      customEvent.data = event.data;
      that.eventTarget.dispatchEvent(customEvent);
    };

    this.ws.onerror = (event) => {
      console.debug("ReconnectingWebSocket", "onerror", that.url, event);

      const customEvent = that.generateEvent("error");
      that.eventTarget.dispatchEvent(customEvent);
    };
  }

  send(data: string | ArrayBuffer | Blob | ArrayBufferView) {
    this.attemptToSend(data, 0);
  }

  close(code?: number | undefined, reason?: string | undefined) {
    // Default CLOSE_NORMAL code
    if (typeof code == "undefined") {
      code = 1000;
    }
    this.forcedClose = true;
    if (this.ws) {
      this.ws.close(code, reason);
    }
  }

  /**
   * Additional public API method to refresh the connection if still open (close, re-open).
   * For example, if the app suspects bad data / missed heart beats, it can try to refresh.
   */
  refresh() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export default ReconnectingAliveSocket;
