"use client";

import { useCallback } from "react";

import { useLang, type Lang } from "@/lib/store";

/**
 * Two-language UI dictionary. Deliberately tiny: flat keys, `{var}`
 * interpolation, explicit one/many keys instead of a plural engine.
 * arXiv taxonomy names (category and group labels) stay in English in
 * both languages — that is how researchers name them.
 */

const EN = {
  "nav.forYou": "For you",
  "nav.search": "Search",
  "nav.library": "Library",
  "nav.topics": "Topics",
  "nav.home": "ScholarPulse home",
  "theme.toLight": "Switch to light theme",
  "theme.toDark": "Switch to dark theme",
  "theme.light": "Light theme",
  "theme.dark": "Dark theme",
  "lang.switch": "Cambiar a español",
  "colophon.tagline": "ScholarPulse — a reading companion for",
  "colophon.enriched": "Enriched by",
  "colophon.press": "Press",
  "colophon.toSearch": "to search",

  "feed.title": "For you",
  "feed.sub": "The newest submissions across the fields you follow.",
  "feed.updated": "Updated {when}.",
  "feed.editTopics": "Edit topics",
  "feed.allFields": "All fields",
  "feed.filterAria": "Filter by topic",
  "feed.caughtUp": "You're caught up — earlier papers below",
  "feed.new": "new",
  "feed.loadMore": "Load more papers",
  "feed.loading": "Loading",
  "feed.emptyTitle": "Nothing here yet",
  "feed.emptyBody":
    "No recent papers for this selection. Try another topic or widen your feed.",
  "feed.missingSnapshot":
    "No snapshot yet for {fields} — these fields will appear after the next site update.",

  "onboard.title": "What are you researching?",
  "onboard.body":
    "Pick the fields you care about and ScholarPulse turns them into a daily feed of the newest papers on arXiv — searchable, citable, and yours to collect.",
  "onboard.pickOne": "Pick at least one field",
  "onboard.buildOne": "Build my feed (1 field)",
  "onboard.buildMany": "Build my feed ({n} fields)",

  "search.title": "Search arXiv",
  "search.sub":
    "Every arXiv paper, by title, abstract, or author — powered by Semantic Scholar.",
  "search.placeholder": "Search titles, abstracts, authors…",
  "search.inputAria": "Search arXiv",
  "search.clearAria": "Clear search",
  "search.sortAria": "Sort results",
  "search.relevance": "Relevance",
  "search.newest": "Newest",
  "search.fieldAria": "Filter by field of study",
  "search.allFields": "All fields",
  "search.recent": "Recent",
  "search.clearRecent": "Clear",
  "search.emptyTitle": "Find your next reference",
  "search.emptyBody":
    "Search across every arXiv paper by keyword, phrase, or author — then filter by field and sort by freshness.",
  "search.noResultsTitle": "No results",
  "search.noResultsBody":
    "Nothing on arXiv matches “{query}”{inField}. Try fewer or broader terms.",
  "search.inField": " in {field}",
  "search.resultsOne": "{n} result",
  "search.resultsMany": "{n} results",

  "paper.back": "Back",
  "paper.save": "Save",
  "paper.inLibrary": "In library",
  "paper.cite": "Cite",
  "paper.citations": "citations",
  "paper.influential": "{n} influential citations",
  "paper.abstract": "Abstract",
  "paper.details": "Details",
  "paper.arxivId": "arXiv ID",
  "paper.categories": "Categories",
  "paper.lastUpdated": "Last updated",
  "paper.journalRef": "Journal reference",
  "paper.comment": "Author comment",
  "paper.alsoOn": "Also on",
  "paper.similar": "Similar papers",
  "paper.literature": "In the literature",
  "paper.buildsOn": "Builds on",
  "paper.buildsOnHint": "its most-cited references",
  "paper.citedBy": "Cited by",
  "paper.citedByHint": "influential follow-up work",
  "paper.graphLoading": "Loading…",
  "paper.graphEmpty": "Nothing indexed here yet.",
  "paper.retry": "Retry",
  "paper.partialNotice":
    "Citation metrics and similar papers are temporarily unavailable (Semantic Scholar rate limit). They will appear on the next visit.",
  "paper.copy": "Copy",
  "paper.bibtexCopied": "BibTeX copied",
  "paper.citationCopied": "Citation copied",
  "paper.copyFailed": "Copy failed — clipboard unavailable",
  "paper.searchByAuthor": "Search papers by {author}",
  "paper.invalidTitle": "No paper here",
  "paper.invalidBody": "This link is missing a valid arXiv identifier.",
  "paper.searchPapers": "Search papers",
  "paper.loadError": "Couldn't load this paper.",

  "lib.title": "Library",
  "lib.sub":
    "Papers you saved, with reading status and notes — stored in this browser.",
  "lib.exportBib": "Export .bib",
  "lib.exportJson": "Export JSON",
  "lib.import": "Import",
  "lib.filterAria": "Filter by status",
  "lib.statusAria": "Reading status",
  "lib.all": "All",
  "lib.toRead": "To read",
  "lib.reading": "Reading",
  "lib.read": "Read",
  "lib.savedWhen": "saved {when}",
  "lib.addNote": "Add note",
  "lib.editNote": "Edit note",
  "lib.hideNote": "Hide note",
  "lib.noteAria": "Personal note",
  "lib.notePlaceholder": "Why does this paper matter for your work?",
  "lib.remove": "Remove",
  "lib.saved": "Saved to library",
  "lib.removed": "Removed from library",
  "lib.saveAria": "Save to library",
  "lib.removeAria": "Remove from library",
  "lib.emptyTitle": "Your library is empty",
  "lib.emptyBody":
    "Tap the bookmark on any paper to keep it here. Notes, reading status, and one-click BibTeX export included.",
  "lib.findPapers": "Find papers",
  "lib.statusEmptyTitle": "Nothing with this status",
  "lib.statusEmptyBody": "Change a paper's status with the buttons on each card.",
  "lib.exportedOne": "Exported 1 reference",
  "lib.exportedMany": "Exported {n} references",
  "lib.imported": "Import — added: {added} · already saved: {skipped}",
  "lib.importInvalid": "That file doesn't look like a ScholarPulse library export",

  "topics.titleFollow": "Topics you follow",
  "topics.subChoose": "Choose the arXiv fields that shape your feed.",
  "topics.subCountOne": "1 field feeding your home page.",
  "topics.subCountMany": "{n} fields feeding your home page.",
  "topics.goToFeed": "Go to feed",
  "topics.rss": "Follow a field from your feed reader instead:",

  "notFound.title": "This page doesn't exist",
  "notFound.body":
    "The link may be old or mistyped. The feed, search, and your library are all still where they should be.",
  "notFound.back": "Back to your feed",

  "errors.tryAgain": "Try again",
  "authors.unknown": "Unknown authors",
  "dates.justNow": "just now",
  "dates.hoursAgo": "{n}h ago",
  "dates.daysAgo": "{n}d ago",
} as const;

export type StringKey = keyof typeof EN;

const ES: Record<StringKey, string> = {
  "nav.forYou": "Para ti",
  "nav.search": "Buscar",
  "nav.library": "Biblioteca",
  "nav.topics": "Temas",
  "nav.home": "Inicio de ScholarPulse",
  "theme.toLight": "Cambiar a tema claro",
  "theme.toDark": "Cambiar a tema oscuro",
  "theme.light": "Tema claro",
  "theme.dark": "Tema oscuro",
  "lang.switch": "Switch to English",
  "colophon.tagline": "ScholarPulse — un compañero de lectura para",
  "colophon.enriched": "Enriquecido con",
  "colophon.press": "Pulsa",
  "colophon.toSearch": "para buscar",

  "feed.title": "Para ti",
  "feed.sub": "Lo último publicado en los campos que sigues.",
  "feed.updated": "Actualizado {when}.",
  "feed.editTopics": "Editar temas",
  "feed.allFields": "Todos los campos",
  "feed.filterAria": "Filtrar por tema",
  "feed.caughtUp": "Estás al día — debajo, papers anteriores",
  "feed.new": "nuevo",
  "feed.loadMore": "Cargar más papers",
  "feed.loading": "Cargando",
  "feed.emptyTitle": "Aún no hay nada aquí",
  "feed.emptyBody":
    "No hay papers recientes para esta selección. Prueba otro tema o amplía tu feed.",
  "feed.missingSnapshot":
    "Aún no hay datos para {fields} — estos campos aparecerán tras la próxima actualización del sitio.",

  "onboard.title": "¿Qué estás investigando?",
  "onboard.body":
    "Elige los campos que te interesan y ScholarPulse los convierte en un feed diario con lo más nuevo de arXiv: buscable, citable y tuyo para coleccionar.",
  "onboard.pickOne": "Elige al menos un campo",
  "onboard.buildOne": "Crear mi feed (1 campo)",
  "onboard.buildMany": "Crear mi feed ({n} campos)",

  "search.title": "Buscar en arXiv",
  "search.sub":
    "Todos los papers de arXiv por título, abstract o autor — con la búsqueda de Semantic Scholar.",
  "search.placeholder": "Busca títulos, abstracts, autores…",
  "search.inputAria": "Buscar en arXiv",
  "search.clearAria": "Borrar búsqueda",
  "search.sortAria": "Ordenar resultados",
  "search.relevance": "Relevancia",
  "search.newest": "Más recientes",
  "search.fieldAria": "Filtrar por campo de estudio",
  "search.allFields": "Todos los campos",
  "search.recent": "Recientes",
  "search.clearRecent": "Borrar",
  "search.emptyTitle": "Encuentra tu próxima referencia",
  "search.emptyBody":
    "Busca en todos los papers de arXiv por palabra clave, frase o autor — filtra por campo y ordena por novedad.",
  "search.noResultsTitle": "Sin resultados",
  "search.noResultsBody":
    "Nada en arXiv coincide con «{query}»{inField}. Prueba con menos términos o más generales.",
  "search.inField": " en {field}",
  "search.resultsOne": "{n} resultado",
  "search.resultsMany": "{n} resultados",

  "paper.back": "Volver",
  "paper.save": "Guardar",
  "paper.inLibrary": "En la biblioteca",
  "paper.cite": "Citar",
  "paper.citations": "citas",
  "paper.influential": "{n} citas influyentes",
  "paper.abstract": "Resumen",
  "paper.details": "Detalles",
  "paper.arxivId": "ID de arXiv",
  "paper.categories": "Categorías",
  "paper.lastUpdated": "Última actualización",
  "paper.journalRef": "Referencia de revista",
  "paper.comment": "Comentario de los autores",
  "paper.alsoOn": "También en",
  "paper.similar": "Papers similares",
  "paper.literature": "En la literatura",
  "paper.buildsOn": "Se apoya en",
  "paper.buildsOnHint": "sus referencias más citadas",
  "paper.citedBy": "Citado por",
  "paper.citedByHint": "trabajo posterior influyente",
  "paper.graphLoading": "Cargando…",
  "paper.graphEmpty": "Aún no hay nada indexado aquí.",
  "paper.retry": "Reintentar",
  "paper.partialNotice":
    "Las métricas de citas y los papers similares no están disponibles ahora mismo (límite de peticiones de Semantic Scholar). Aparecerán en la próxima visita.",
  "paper.copy": "Copiar",
  "paper.bibtexCopied": "BibTeX copiado",
  "paper.citationCopied": "Cita copiada",
  "paper.copyFailed": "No se pudo copiar — portapapeles no disponible",
  "paper.searchByAuthor": "Buscar papers de {author}",
  "paper.invalidTitle": "Aquí no hay ningún paper",
  "paper.invalidBody": "A este enlace le falta un identificador válido de arXiv.",
  "paper.searchPapers": "Buscar papers",
  "paper.loadError": "No se pudo cargar este paper.",

  "lib.title": "Biblioteca",
  "lib.sub":
    "Tus papers guardados, con estado de lectura y notas — almacenados en este navegador.",
  "lib.exportBib": "Exportar .bib",
  "lib.exportJson": "Exportar JSON",
  "lib.import": "Importar",
  "lib.filterAria": "Filtrar por estado",
  "lib.statusAria": "Estado de lectura",
  "lib.all": "Todos",
  "lib.toRead": "Por leer",
  "lib.reading": "Leyendo",
  "lib.read": "Leído",
  "lib.savedWhen": "guardado {when}",
  "lib.addNote": "Añadir nota",
  "lib.editNote": "Editar nota",
  "lib.hideNote": "Ocultar nota",
  "lib.noteAria": "Nota personal",
  "lib.notePlaceholder": "¿Por qué importa este paper para tu trabajo?",
  "lib.remove": "Quitar",
  "lib.saved": "Guardado en la biblioteca",
  "lib.removed": "Quitado de la biblioteca",
  "lib.saveAria": "Guardar en la biblioteca",
  "lib.removeAria": "Quitar de la biblioteca",
  "lib.emptyTitle": "Tu biblioteca está vacía",
  "lib.emptyBody":
    "Toca el marcador en cualquier paper para guardarlo aquí. Con notas, estado de lectura y export BibTeX a un clic.",
  "lib.findPapers": "Buscar papers",
  "lib.statusEmptyTitle": "Nada con este estado",
  "lib.statusEmptyBody": "Cambia el estado de un paper con los botones de cada tarjeta.",
  "lib.exportedOne": "1 referencia exportada",
  "lib.exportedMany": "{n} referencias exportadas",
  "lib.imported": "Importación — añadidos: {added} · ya guardados: {skipped}",
  "lib.importInvalid": "Ese archivo no parece un export de la biblioteca de ScholarPulse",

  "topics.titleFollow": "Temas que sigues",
  "topics.subChoose": "Elige los campos de arXiv que dan forma a tu feed.",
  "topics.subCountOne": "1 campo alimenta tu página principal.",
  "topics.subCountMany": "{n} campos alimentan tu página principal.",
  "topics.goToFeed": "Ir al feed",
  "topics.rss": "Sigue un campo desde tu lector de feeds:",

  "notFound.title": "Esta página no existe",
  "notFound.body":
    "El enlace puede ser antiguo o estar mal escrito. El feed, la búsqueda y tu biblioteca siguen donde deberían.",
  "notFound.back": "Volver a tu feed",

  "errors.tryAgain": "Reintentar",
  "authors.unknown": "Autores desconocidos",
  "dates.justNow": "ahora mismo",
  "dates.hoursAgo": "hace {n} h",
  "dates.daysAgo": "hace {n} d",
};

const STRINGS: Record<Lang, Record<StringKey, string>> = { en: EN, es: ES };

export type Translate = (
  key: StringKey,
  vars?: Record<string, string | number>,
) => string;

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** UI strings in the active language. Re-renders on language change. */
export function useT(): { t: Translate; lang: Lang; setLang: (lang: Lang) => void } {
  const { lang, setLang } = useLang();
  const t = useCallback<Translate>(
    (key, vars) => interpolate(STRINGS[lang][key], vars),
    [lang],
  );
  return { t, lang, setLang };
}
