import { MessageCircle, Phone } from "lucide-react";
import { smallBtn } from "./shared";

const btn = `inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 font-medium text-ink ${smallBtn}`;

/** Ligar e WhatsApp. `tel` e `whatsapp` vêm prontos do servidor (telHref/whatsappHref: só dígitos). */
export function ContactButtons({ name, tel, whatsapp }: { name: string; tel: string | null; whatsapp: string | null }) {
  if (!tel && !whatsapp) return null;
  return (
    <span className="inline-flex flex-wrap gap-2">
      {tel && (
        <a href={tel} className={btn} aria-label={`Ligar para ${name}`}>
          <Phone size={16} aria-hidden /> Ligar
        </a>
      )}
      {whatsapp && (
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={btn} aria-label={`WhatsApp de ${name}`}>
          <MessageCircle size={16} aria-hidden /> WhatsApp
        </a>
      )}
    </span>
  );
}
