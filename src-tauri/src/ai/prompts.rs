pub const DEFAULT_TARGET_LANG: &str = "Hindi";

pub fn build_word_lookup_system_prompt(target_lang: Option<&str>) -> String {
    let lang = target_lang.unwrap_or(DEFAULT_TARGET_LANG);
    let lang = if lang.trim().is_empty() { DEFAULT_TARGET_LANG } else { lang };
    format!(
r#"You are a concise bilingual dictionary for an avid reader. Given a word and the context sentence it appears in,
return ONLY JSON: {{"word":"", "part_of_speech":"", "meaning":"", "meaning_hindi":"", "meaning_in_context":"", "example":"", "synonyms":["",""], "pronunciation":""}}.
Keep "meaning" under 25 words in clear English.
Provide "meaning_hindi" as the translation and natural meaning in {lang}.
Use simple, elegant language."#
    )
}

pub fn build_word_chat_system_prompt(word: &str, context: Option<&str>, target_lang: Option<&str>) -> String {
    let lang = target_lang.unwrap_or(DEFAULT_TARGET_LANG);
    let lang = if lang.trim().is_empty() { DEFAULT_TARGET_LANG } else { lang };
    let ctx_line = match context {
        Some(c) if !c.trim().is_empty() => format!("\nContext sentence from the book: \"{}\"", c.trim()),
        _ => String::new(),
    };
    format!(
r#"You are an intelligent reading tutor and dictionary assistant embedded inside a book reader.
The user is reading a book and inquiring specifically about the target word or phrase: "{word}".{ctx_line}
Provide concise, insightful, and helpful answers directly focused on "{word}".
When relevant or requested, explain nuances, practical usage examples, {lang} translation/meaning, word origin, or synonyms.
Never say you do not know the word or that the user didn't provide one; the target word is "{word}".
Always format your response cleanly with clear line breaks, paragraphs, and distinct bullet points (each on a new line). Never cram bullet points together on the same line.
Keep replies brief, clear, and easy to read during reading flow (under 130 words)."#
    )
}

pub fn build_passage_system_prompt(mode: &str, target_lang: Option<&str>) -> String {
    let lang = target_lang.unwrap_or(DEFAULT_TARGET_LANG);
    let lang = if lang.trim().is_empty() { DEFAULT_TARGET_LANG } else { lang };

    match mode {
        "translate" => format!(
            r#"You are a professional literary translator.
Translate the provided passage accurately and naturally into {lang}.
Maintain original tone, style, and literary context.
Output only the clean translation followed optionally by a brief 1-line note if there are cultural or subtle nuances."#
        ),
        "summarize" => format!(
            r#"You are an executive reading assistant.
Summarize the main ideas and core takeaways of the provided passage into 2-3 clear, insightful bullet points.
Also include a 1-line summary in {lang}."#
        ),
        _ => format!(
            r#"You are an insightful reading tutor and scholar.
Explain the meaning and core themes of the provided passage in clear, accessible language.
Highlight key takeaways, simplify complex sentence structures or idioms, and provide a 1-sentence summary in {lang}.
Keep the explanation engaging, concise (under 120 words), and formatted cleanly."#
        ),
    }
}

pub fn build_word_lookup_prompt(word: &str, sentence: Option<&str>) -> String {
    match sentence {
        Some(s) if !s.trim().is_empty() => {
            format!("Word: \"{word}\"\nContext Sentence: \"{s}\"")
        }
        _ => format!("Word: \"{word}\""),
    }
}

pub fn build_passage_user_prompt(passage: &str, context: Option<&str>) -> String {
    match context {
        Some(ctx) if !ctx.trim().is_empty() => {
            format!("Surrounding Context:\n\"\"\"{ctx}\"\"\"\n\nPassage to process:\n\"\"\"{passage}\"\"\"")
        }
        _ => format!("Passage to process:\n\"\"\"{passage}\"\"\""),
    }
}


