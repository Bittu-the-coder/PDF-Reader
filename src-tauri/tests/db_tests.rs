use shelf_lib::db::*;
use shelf_lib::error::AppError;
use tempfile::NamedTempFile;

fn setup_test_db() -> Database {
    let temp_file = NamedTempFile::new().unwrap();
    Database::open(temp_file.path()).expect("failed to open test database")
}

#[test]
fn test_shelves_crud() {
    let db = setup_test_db();

    let shelf = db.create_shelf("Fiction").unwrap();
    assert_eq!(shelf.name, "Fiction");

    let shelves = db.list_shelves().unwrap();
    // Default 'My Books' + 'Fiction'
    assert!(shelves.iter().any(|s| s.name == "Fiction"));

    db.rename_shelf(shelf.id, "Classic Fiction").unwrap();
    let shelves = db.list_shelves().unwrap();
    assert!(shelves.iter().any(|s| s.name == "Classic Fiction"));

    db.delete_shelf(shelf.id).unwrap();
    let shelves = db.list_shelves().unwrap();
    assert!(!shelves.iter().any(|s| s.id == shelf.id));
}

#[test]
fn test_book_crud_and_cascade_delete() {
    let db = setup_test_db();

    let book = db
        .add_book(
            &AddBook {
                title: "Test Book".into(),
                author: Some("Author".into()),
                file_path: "/path/to/test.pdf".into(),
                file_hash: "hash123".into(),
                page_count: Some(100),
                cover_png: None,
            },
            None,
        )
        .unwrap();

    assert_eq!(book.title, "Test Book");

    // Add chapter
    let ch = db
        .create_chapter(&CreateChapter {
            book_id: book.id,
            title: "Chapter 1".into(),
            start_page: 1,
            position: 0,
            source: None,
        })
        .unwrap();

    // Add word
    let word = db
        .add_word(&AddWord {
            book_id: book.id,
            chapter_id: Some(ch.id),
            word: "Serendipity".into(),
            meaning: "Finding good things without looking for them".into(),
            meaning_hindi: Some("अप्रत्याशित लाभ".into()),
            example_sentence: Some("A stroke of serendipity".into()),
            page: Some(5),
            ai_generated: Some(false),
        })
        .unwrap();

    // Add note
    let note = db
        .add_note(&AddNote {
            book_id: book.id,
            chapter_id: Some(ch.id),
            content: "Great intro".into(),
            page: Some(2),
            quote: None,
        })
        .unwrap();

    assert_eq!(word.word, "Serendipity");
    assert_eq!(note.content, "Great intro");

    // Verify cascade delete: deleting book deletes chapters, words, notes
    db.delete_book(book.id).unwrap();

    assert!(db.get_book(book.id).is_err());
    assert_eq!(db.list_chapters(book.id).unwrap().len(), 0);
    assert_eq!(db.list_words(book.id, None).unwrap().len(), 0);
    assert_eq!(db.list_notes(book.id, None).unwrap().len(), 0);
}

#[test]
fn test_duplicate_word_rule() {
    let db = setup_test_db();

    let book = db
        .add_book(
            &AddBook {
                title: "Vocab Book".into(),
                author: None,
                file_path: "/path/book.pdf".into(),
                file_hash: "hash_vocab".into(),
                page_count: Some(50),
                cover_png: None,
            },
            None,
        )
        .unwrap();

    let ch = db
        .create_chapter(&CreateChapter {
            book_id: book.id,
            title: "Chapter 1".into(),
            start_page: 1,
            position: 0,
            source: None,
        })
        .unwrap();

    // Add word first time
    db.add_word(&AddWord {
        book_id: book.id,
        chapter_id: Some(ch.id),
        word: "Ephemeral".into(),
        meaning: "Lasting for a very short time".into(),
        meaning_hindi: None,
        example_sentence: None,
        page: Some(3),
        ai_generated: None,
    })
    .unwrap();

    // Add same word in same chapter (case-insensitive) -> should fail with DuplicateWord
    let res = db.add_word(&AddWord {
        book_id: book.id,
        chapter_id: Some(ch.id),
        word: "ephemeral".into(),
        meaning: "Duplicate meaning".into(),
        meaning_hindi: None,
        example_sentence: None,
        page: Some(3),
        ai_generated: None,
    });

    match res {
        Err(AppError::DuplicateWord { word }) => {
            assert_eq!(word, "ephemeral");
        }
        _ => panic!("Expected DuplicateWord error, got {:?}", res),
    }
}

#[test]
fn test_auto_assign_chapter_by_page() {
    let db = setup_test_db();

    let book = db
        .add_book(
            &AddBook {
                title: "Multi Chapter".into(),
                author: None,
                file_path: "/path/multi.pdf".into(),
                file_hash: "hash_multi".into(),
                page_count: Some(100),
                cover_png: None,
            },
            None,
        )
        .unwrap();

    // Outline: Ch 1 (page 1), Ch 2 (page 20), Ch 3 (page 50)
    let ch1 = db
        .create_chapter(&CreateChapter {
            book_id: book.id,
            title: "Chapter 1".into(),
            start_page: 1,
            position: 0,
            source: Some("outline".into()),
        })
        .unwrap();

    let ch2 = db
        .create_chapter(&CreateChapter {
            book_id: book.id,
            title: "Chapter 2".into(),
            start_page: 20,
            position: 1,
            source: Some("outline".into()),
        })
        .unwrap();

    let ch3 = db
        .create_chapter(&CreateChapter {
            book_id: book.id,
            title: "Chapter 3".into(),
            start_page: 50,
            position: 2,
            source: Some("outline".into()),
        })
        .unwrap();

    // Word on page 15 should map to Ch 1
    let w1 = db
        .add_word(&AddWord {
            book_id: book.id,
            chapter_id: None,
            word: "WordPage15".into(),
            meaning: "test".into(),
            meaning_hindi: None,
            example_sentence: None,
            page: Some(15),
            ai_generated: None,
        })
        .unwrap();
    assert_eq!(w1.chapter_id, Some(ch1.id));

    // Word on page 35 should map to Ch 2
    let w2 = db
        .add_word(&AddWord {
            book_id: book.id,
            chapter_id: None,
            word: "WordPage35".into(),
            meaning: "test".into(),
            meaning_hindi: None,
            example_sentence: None,
            page: Some(35),
            ai_generated: None,
        })
        .unwrap();
    assert_eq!(w2.chapter_id, Some(ch2.id));

    // Note on page 50 should map to Ch 3
    let n1 = db
        .add_note(&AddNote {
            book_id: book.id,
            chapter_id: None,
            content: "Note page 50".into(),
            page: Some(50),
            quote: None,
        })
        .unwrap();
    assert_eq!(n1.chapter_id, Some(ch3.id));
}

#[test]
fn test_bookmarks_and_review() {
    let db = setup_test_db();
    let book = db
        .add_book(
            &AddBook {
                title: "Test".into(),
                author: None,
                file_path: "/tmp/test.pdf".into(),
                file_hash: "hash-review".into(),
                page_count: Some(10),
                cover_png: None,
            },
            None,
        )
        .unwrap();

    db.add_bookmark(book.id, 3, None).unwrap();
    db.add_bookmark(book.id, 3, Some("again")).unwrap();
    db.add_bookmark(book.id, 7, None).unwrap();
    let marks = db.list_bookmarks(book.id).unwrap();
    assert_eq!(marks.iter().map(|b| b.page).collect::<Vec<_>>(), vec![3, 7]);
    db.delete_bookmark(book.id, 3).unwrap();
    assert_eq!(db.list_bookmarks(book.id).unwrap().len(), 1);

    let word = db
        .add_word(&AddWord {
            book_id: book.id,
            chapter_id: None,
            word: "ephemeral".into(),
            meaning: "short-lived".into(),
            meaning_hindi: None,
            example_sentence: None,
            page: Some(1),
            ai_generated: None,
        })
        .unwrap();

    // New words are due immediately; a "good" review schedules them a day out
    assert_eq!(db.count_due_cards(Some(book.id)).unwrap(), 1);
    db.review_card(word.id, Grade::Good).unwrap();
    assert_eq!(db.count_due_cards(Some(book.id)).unwrap(), 0);

    assert_eq!(next_stability(0.0, Grade::Good), 1.0);
    assert_eq!(next_stability(2.0, Grade::Good), 5.0);
    assert_eq!(next_stability(5.0, Grade::Again), 0.0);

    db.log_reading(book.id, 120, 4).unwrap();
    let stats = db.reading_stats(book.id).unwrap();
    assert_eq!((stats.seconds, stats.pages), (120, 4));
}
