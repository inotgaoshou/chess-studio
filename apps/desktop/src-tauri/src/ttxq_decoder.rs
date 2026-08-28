/// Converts QQ Chess/DhtmlXQ four-digit coordinates into ICCS moves.
///
/// Every group is `from_file, from_red_side_rank, to_file, to_red_side_rank`.
/// The H5 board stores ranks from the red side, while ICCS counts from black's
/// side, so ranks are inverted with `9 - value`.
pub(crate) fn dhtml_move_list_to_iccs(raw: &str) -> Vec<String> {
    if !raw.chars().all(|character| {
        character.is_ascii_digit()
            || matches!(character, '[' | ']' | ',' | ' ' | '\t' | '\r' | '\n')
    }) {
        return Vec::new();
    }
    let compact: String = raw.chars().filter(char::is_ascii_digit).collect();
    if compact.len() < 4 || compact.len() % 4 != 0 {
        return Vec::new();
    }
    compact
        .as_bytes()
        .chunks_exact(4)
        .map(|chunk| {
            let digits = chunk.iter().map(|value| value - b'0').collect::<Vec<_>>();
            let [from_file, from_rank, to_file, to_rank] = digits.as_slice() else {
                return None;
            };
            (*from_file <= 8 && *to_file <= 8 && *from_rank <= 9 && *to_rank <= 9).then(|| {
                let square = |file: u8, rank: u8| format!("{}{}", (b'a' + file) as char, 9 - rank);
                format!(
                    "{}{}",
                    square(*from_file, *from_rank),
                    square(*to_file, *to_rank)
                )
            })
        })
        .collect::<Option<Vec<_>>>()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_dhtml_coordinates_to_iccs() {
        assert_eq!(dhtml_move_list_to_iccs("26252042"), ["c3c4", "c9e7"]);
        assert_eq!(dhtml_move_list_to_iccs("2,6,2,5,2,0,4,2"), ["c3c4", "c9e7"]);
    }

    #[test]
    fn rejects_non_coordinate_payloads() {
        assert!(dhtml_move_list_to_iccs("炮二平五").is_empty());
        assert!(dhtml_move_list_to_iccs("123").is_empty());
    }

    #[test]
    fn rejects_a_coordinate_stream_with_any_out_of_range_group() {
        assert!(dhtml_move_list_to_iccs("26259999").is_empty());
    }
}
