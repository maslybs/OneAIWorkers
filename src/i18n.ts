export function bi(en: string, uk: string): string {
  return `${en}\n\nУкраїнською: ${uk}`;
}

export function biInline(en: string, uk: string): string {
  return `${en} / ${uk}`;
}

export function bilingualObject(en: string, uk: string) {
  return { en, uk };
}
