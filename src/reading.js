/* The reading card: real HTML text, large and crisp. Each token is a span that cascades in
   when the page arrives, lights up while the narrator says it, and can be tapped; tokens
   linked to the scene are marked and point at their object on hover. */

export class Reading {
  constructor(panel, handlers) {
    this.panel = panel;
    this.handlers = handlers; // { onWordTap(index, token, span), onLinkHover(name, on, span), onDone() }
    this.el = {
      eyebrow: panel.querySelector("#page-eyebrow"),
      heading: panel.querySelector("#page-heading"),
      words: panel.querySelector("#page-words"),
      hint: panel.querySelector("#page-hint"),
      done: panel.querySelector("#read-done"),
      end: panel.querySelector("#end-actions"),
    };
    this.spans = [];
    this.active = -1;
    this.el.done.addEventListener("click", () => { this.hideDone(); handlers.onDone(); });
  }

  show({ eyebrow, heading, hint, tokens, isEnd }) {
    const { el } = this;
    this.hideDone();
    el.eyebrow.textContent = eyebrow;
    el.heading.textContent = heading;
    el.hint.textContent = hint || "";
    el.hint.classList.remove("nudge");
    el.end.hidden = !isEnd;
    el.words.replaceChildren();
    this.spans = tokens.map((token, i) => {
      const span = document.createElement("span");
      span.className = "word" + (token.link ? " link" : "");
      span.textContent = token.text;
      span.style.setProperty("--i", String(i));
      span.addEventListener("click", (event) => {
        event.stopPropagation();
        span.classList.remove("tapped");
        void span.offsetWidth; // restart the animation
        span.classList.add("tapped");
        this.handlers.onWordTap(i, token, span);
      });
      if (token.link) {
        span.addEventListener("pointerenter", () => this.handlers.onLinkHover(token.link, true, span));
        span.addEventListener("pointerleave", () => this.handlers.onLinkHover(token.link, false, span));
      }
      el.words.appendChild(span);
      return span;
    });
    this.active = -1;
    this.panel.hidden = false;
    this.panel.classList.remove("arriving");
    void this.panel.offsetWidth;
    this.panel.classList.add("arriving");
  }

  setActive(i) {
    if (this.active >= 0 && this.spans[this.active]) {
      this.spans[this.active].classList.remove("active");
      this.spans[this.active].classList.add("spoken");
    }
    this.active = i;
    const span = this.spans[i];
    if (span) {
      span.classList.add("active");
      span.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  clearActive() {
    for (const s of this.spans) s.classList.remove("active", "spoken");
    this.active = -1;
  }

  nudgeHint() {
    this.el.hint.classList.add("nudge");
  }

  /** Self-read mode: the "I read it" button comes up after about as long as the page takes. */
  offerDone(delay) {
    this.hideDone();
    this.doneTimer = setTimeout(() => { this.el.done.hidden = false; }, delay);
  }

  hideDone() {
    clearTimeout(this.doneTimer);
    this.el.done.hidden = true;
  }

  hide() {
    this.hideDone();
    this.panel.hidden = true;
  }
}
