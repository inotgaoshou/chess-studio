//! Read-only inventory including records rejected by the game parser.
use manual_format::import_cbl_game_library_reader;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{env, fs::{self, File}};
fn utf16(bytes:&[u8])->String {String::from_utf16_lossy(&bytes.chunks_exact(2).map(|p|u16::from_le_bytes([p[0],p[1]])).take_while(|v|*v!=0).collect::<Vec<_>>())}
fn main()->Result<(),Box<dyn std::error::Error>>{
 let path=env::args().nth(1).ok_or("book_inventory <file.cbl>")?;
 let bytes=fs::read(&path)?;let mut raw=vec![];
 if let Some(start)=bytes.windows(16).position(|w|w==b"CCBridge Record\0"){
  for (index,r) in bytes[start..].chunks(4096).enumerate(){
   if !r.starts_with(b"CCBridge Record\0"){continue;}
   let field=|a,b|utf16(r.get(a..b).unwrap_or_default());
   let tail=r.get(2214..).unwrap_or_default();
   let integer=|at|tail.get(at..at+4).map(|v|u32::from_le_bytes(v.try_into().unwrap()) as usize);
   let end=if integer(0)==Some(0){Some(4)}else{integer(4).and_then(|n|n.checked_add(8)).filter(|n|*n<=tail.len())};
   let note=end.filter(|n|*n>4).map(|n|utf16(&tail[8..n])).unwrap_or_default();
   let empty=r.len()==4096&&end.and_then(|n|tail.get(n..n+4)).is_some_and(|p|p==[0,0,0,0]);
   raw.push(json!({"sourceIndex":index,"recordHash":format!("{:x}",Sha256::digest(r)),"title":field(180,308),"category":field(692,756),"note":note,"red":field(1076,1140),"black":field(1300,1364),"emptyMoves":empty,"completeRecord":r.len()==4096}));
  }
 }
 let mut records=vec![];let mut file=File::open(path)?;
 let summary=import_cbl_game_library_reader(&mut file,None,|game|{
  let d=game.document;let tree=serde_json::to_value(&d.tree).map_err(|e|e.to_string())?;
  let count=tree["nodes"].as_object().map_or(0,|n|n.values().filter(|n|n["deleted"]==false).count());
  records.push(json!({"sourceIndex":game.source_index,"title":d.metadata.title,"category":d.metadata.event,"note":d.note,"startingFen":d.starting_fen,"moveCount":count,"warnings":game.warnings,"documentWarnings":d.warnings,"red":d.metadata.red,"black":d.metadata.black}));Ok(())
 })?;
 println!("{}",serde_json::to_string(&json!({"summary":summary,"rawRecordCount":raw.len(),"rawSourceIndices":raw.iter().map(|r|r["sourceIndex"].clone()).collect::<Vec<_>>(),"rawRecords":raw,"records":records}))?);Ok(())
}
