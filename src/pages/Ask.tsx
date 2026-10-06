import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/bits";
import { supabase } from "../lib/data";
import { useTitle } from "../lib/title";

const REPLY_CONSENT =
  "Zgadzam się, żeby Padok użył mojego adresu e-mail wyłącznie do odpowiedzi na tę wiadomość. Mogę wycofać zgodę w każdej chwili.";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

export function Ask() {
  useTitle("Zadaj pytanie");
  const id = useId();
  const [topic, setTopic] = useState<"pytanie" | "blad" | "pomysl">("pytanie");
  const [message, setMessage] = useState("");
  const [wantsReply, setWantsReply] = useState(false);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length < 10) {
      setState({ kind: "error", message: "Napisz chociaż jedno zdanie (minimum 10 znaków)." });
      return;
    }
    if (wantsReply && (!email.includes("@") || !consent)) {
      setState({ kind: "error", message: "Żeby odpisać, potrzebujemy adresu e-mail i twojej zgody na jego użycie." });
      return;
    }
    setState({ kind: "sending" });
    const { error } = await supabase.from("questions").insert({
      topic,
      message: message.trim(),
      email: wantsReply ? email.trim() : null,
      consent_reply: wantsReply && consent,
      consent_text: wantsReply ? REPLY_CONSENT : "Bez adresu e-mail, bez odpowiedzi.",
    });
    if (error) {
      setState({
        kind: "error",
        message: error.message.includes("Za dużo")
          ? "Dostaliśmy właśnie bardzo dużo wiadomości. Spróbuj ponownie za kilka minut."
          : "Nie udało się wysłać. Sprawdź połączenie i spróbuj jeszcze raz.",
      });
      return;
    }
    setState({ kind: "sent" });
    setMessage("");
    setEmail("");
    setConsent(false);
  }

  if (state.kind === "sent") {
    return (
      <article>
        <PageHead kicker="Wysłane" title="Dzięki, dotarło">
          <p>
            {wantsReply
              ? "Odpiszemy na podany adres. Zwykle trwa to kilka dni."
              : "Bez adresu e-mail nie odpiszemy, ale przeczytamy i poprawimy, co trzeba."}
          </p>
        </PageHead>
        <button type="button" className="btn" onClick={() => setState({ kind: "idle" })}>
          Napisz kolejną wiadomość
        </button>
      </article>
    );
  }

  return (
    <article className="ask">
      <PageHead kicker="Pytania i błędy" title="Czegoś nie rozumiesz? Zapytaj">
        <p>
          Nie ma głupich pytań o F1, są tylko źle wytłumaczone przepisy. Błąd w danych albo w tekście też zgłaszaj tutaj.
        </p>
      </PageHead>

      <form onSubmit={submit} noValidate className="form">
        <fieldset>
          <legend>O czym piszesz?</legend>
          {(
            [
              ["pytanie", "Mam pytanie o F1"],
              ["blad", "Na stronie jest błąd"],
              ["pomysl", "Mam pomysł, co dodać"],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="radio">
              <input type="radio" name="topic" value={v} checked={topic === v} onChange={() => setTopic(v)} />
              {label}
            </label>
          ))}
        </fieldset>

        <label htmlFor={`${id}-msg`}>Twoja wiadomość</label>
        <textarea
          id={`${id}-msg`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          maxLength={2000}
          required
          aria-describedby={`${id}-msg-hint`}
        />
        <p id={`${id}-msg-hint`} className="hint">
          Od 10 do 2000 znaków. Nie wpisuj tu danych osobowych innych osób.
        </p>

        <label className="check">
          <input type="checkbox" checked={wantsReply} onChange={(e) => setWantsReply(e.target.checked)} />
          Chcę dostać odpowiedź mailem
        </label>

        {wantsReply && (
          <div className="form__reply">
            <label htmlFor={`${id}-email`}>Adres e-mail</label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label className="check">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
              {REPLY_CONSENT}
            </label>
          </div>
        )}

        <p className="hint">
          Zapisujemy tylko treść, temat i (jeśli podasz) e-mail. Bez imienia, bez numeru telefonu. Wiadomości bez adresu
          usuwamy po 90 dniach. Więcej w <Link to="/prywatnosc">polityce prywatności</Link>.
        </p>

        {state.kind === "error" && (
          <p className="form__error" role="alert">
            {state.message}
          </p>
        )}

        <button type="submit" className="btn btn--primary" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Wysyłam…" : "Wyślij wiadomość"}
        </button>
      </form>
    </article>
  );
}
