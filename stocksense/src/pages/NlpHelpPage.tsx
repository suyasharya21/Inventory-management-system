import { FormEvent, useEffect, useState } from 'react';
import { BotMessageSquare, CircleAlert, Database, ExternalLink, Mic, MicOff, Send, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate, formatNumber, humanize } from '../lib/format';
import type { NlpAnswer, PageId } from '../types/app';
import { Badge, Button, DataTable, LoadingState } from '../components/Ui';
import { IconButton } from '../components/Ui';
import { useSpeechInput } from '../hooks/useSpeechInput';

type Exchange = { question: string; answer?: NlpAnswer; error?: string };

export function NlpHelpPage({ currency, onNavigate }: { currency: string; onNavigate(page: PageId): void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);
  const [loading, setLoading] = useState(false);
  const speech = useSpeechInput(setQuestion);
  useEffect(() => { void api.nlpHelp.suggestedQuestions().then(setSuggestions); }, []);

  const ask = async (event?: FormEvent, prompt = question) => {
    event?.preventDefault();
    if (!prompt.trim()) return;
    const pendingIndex = history.length;
    setHistory((current) => [...current, { question: prompt }]);
    setQuestion('');
    setLoading(true);
    try {
      const answer = await api.nlpHelp.answer(prompt);
      setHistory((current) => current.map((item, index) => index === pendingIndex ? { ...item, answer } : item));
    } catch (reason) {
      setHistory((current) => current.map((item, index) => index === pendingIndex ? { ...item, error: reason instanceof Error ? reason.message : 'The question could not be answered.' } : item));
    } finally { setLoading(false); }
  };

  const navigateToSource = (source: string, intent: string) => {
    const page = source === 'inventory' ? 'inventory' : source === 'dashboard' ? 'dashboard' : source === 'anomalies' ? 'anomalies' : source === 'audit' ? 'audit' : source === 'reports' ? 'reports' : 'nlp-help';
    if (page === 'reports') {
      const reportType = intent === 'price_changes' ? 'price_changes' : ['product_sales', 'sales_summary', 'top_products'].includes(intent) ? 'sales' : 'inventory';
      window.sessionStorage.setItem('stocksense-report-type', reportType);
    }
    onNavigate(page);
  };

  return <div className="page-stack nlp-page">
    <div className="page-heading"><div><span className="eyebrow">Answers from your records</span><h1>Ask about your business</h1><p>Type or speak a question about stock, sales, profit, price changes, change history, or unusual activity.</p></div><div className="local-only-badge"><ShieldCheck size={17} /><span><strong>Reads only your local records</strong><small>Questions cannot change the database</small></span></div></div>
    <div className="nlp-disclaimer"><CircleAlert size={18} /><p>Answers use the records available on this computer. They can be incomplete when information is missing or filters are applied. Check the matching records before making important decisions.</p></div>
    <section className="nlp-workspace">
      <aside className="question-library"><span className="catalog-title">Example questions</span>{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void ask(undefined, suggestion)}><Database size={16} /><span>{suggestion}</span></button>)}<div className="query-scope"><strong>Questions you can ask</strong><span>Available stock</span><span>Sales and profit after product cost</span><span>Best-selling products</span><span>Products running low</span><span>Price changes</span><span>Unusual activity</span></div></aside>
      <div className="conversation-panel">
        <div className="conversation-scroll">
          {!history.length && <div className="assistant-welcome"><span className="assistant-avatar"><BotMessageSquare size={22} /></span><div><strong>What would you like to know?</strong><p>I use the same calculations as your reports. Each answer shows the dates used, how it was calculated, and the matching records.</p></div></div>}
          {history.map((exchange, index) => <div className="exchange" key={`${exchange.question}-${index}`}>
            <div className="question-bubble"><span><UserRound size={16} /></span><p>{exchange.question}</p></div>
            {exchange.error && <div className="answer-bubble answer-error"><CircleAlert size={18} /><p>{exchange.error}</p></div>}
            {exchange.answer ? <AnswerBlock answer={exchange.answer} currency={currency} onSource={() => navigateToSource(exchange.answer!.sourcePage, exchange.answer!.intent)} onGuidance={(page) => onNavigate(page)} /> : index === history.length - 1 && loading ? <LoadingState label="Reading local records" /> : null}
          </div>)}
        </div>
        {speech.error && <div className="speech-error"><CircleAlert size={15} />{speech.error}</div>}
        <form className="nlp-composer" onSubmit={ask}><textarea rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="For example: How many Coca-Cola bottles were sold in the last 7 days?" /><IconButton type="button" className={speech.listening ? 'listening' : ''} label={speech.listening ? 'Stop voice typing' : speech.transcribing ? 'Transcribing voice question' : 'Start voice typing'} disabled={!speech.supported || speech.transcribing} onClick={() => speech.listening ? void speech.stop() : void speech.start(question)}>{speech.listening ? <MicOff size={18} /> : <Mic size={18} />}</IconButton><Button type="submit" icon={<Send size={16} />} disabled={loading || !question.trim()}>Ask</Button></form>
      </div>
    </section>
  </div>;
}

function AnswerBlock({ answer, currency, onSource, onGuidance }: { answer: NlpAnswer; currency: string; onSource(): void; onGuidance(page: PageId): void }) {
  const columns = answer.rows.length ? Object.keys(answer.rows[0]).filter((key) => !['businessId', 'normalizedName', 'evidence', 'before', 'after', 'fieldChanges'].includes(key)).slice(0, 6).map((key) => ({ key, label: humanize(key), render: (row: Record<string, unknown>) => formatCell(key, row[key], currency) })) : [];
  return <div className="answer-bubble"><div className="answer-head"><span className="assistant-avatar"><BotMessageSquare size={18} /></span><div><strong>{answer.title}</strong><small>{String(answer.filters.periodLabel ?? '')} · {answer.sourceCount} matching record(s)</small></div><Badge tone={answer.status === 'answered' ? 'success' : 'warning'}>{answer.status === 'answered' ? 'Answered' : 'Needs help'}</Badge></div><p className="answer-summary">{answer.summary}</p>{answer.metrics && <div className="answer-metrics">{answer.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.currency ? formatCurrency(metric.value, currency) : `${formatNumber(metric.value)}${metric.suffix ? ` ${metric.suffix}` : ''}`}</strong></div>)}</div>}{answer.calculation && <div className="calculation-note"><Database size={16} /><span><strong>How this was worked out</strong>{answer.calculation}</span></div>}{answer.rows.length > 0 && <div className="answer-table"><DataTable rows={answer.rows.slice(0, 8)} columns={columns} /></div>}{answer.guidance && <div className="guidance-step"><div><strong>{answer.guidance.title}</strong><p>{answer.guidance.description}</p>{answer.guidance.example && <code>Example: {answer.guidance.example}</code>}</div>{answer.guidance.steps && <ol>{answer.guidance.steps.map((step) => <li key={step}>{step}</li>)}</ol>}<Button icon={<ExternalLink size={15} />} onClick={() => onGuidance(answer.guidance!.targetPage)}>{answer.guidance.actionLabel}</Button></div>}<div className="answer-footer"><span>Answered {formatDate(answer.generatedAt, true)}</span>{answer.sourcePage !== 'nlp-help' && answer.status === 'answered' && <Button variant="ghost" icon={<ExternalLink size={15} />} onClick={onSource}>Open matching records</Button>}</div></div>;
}

function formatCell(key: string, value: unknown, currency: string) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number' && /(price|cost|value|sales|profit|total)/i.test(key)) return formatCurrency(value, currency);
  if (typeof value === 'number') return formatNumber(value);
  if (/date|At$/.test(key) && typeof value === 'string') return formatDate(value, key.endsWith('At'));
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
