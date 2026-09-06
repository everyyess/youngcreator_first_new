import { NextRequest, NextResponse } from "next/server";
import { formatSupabaseError, getInsightSupabase, insightDbUnavailable } from "@/lib/supabaseInsightDb";
import { extractMappedTags, normalizeCompanies, normalizeMacro, normalizeTopics } from "@/lib/tagRules";
import { loadLiveInsightSources, type LiveInsightCandidate } from "@/lib/liveInsightSources";

export type InsightSource = "telegram" | "news" | "report";
export type InsightItem = { id:string; source:InsightSource; title:string; summary:string; notes:string; topics:string[]; companies:string[]; macro:string[]; date:string; createdAt:string; url:string|null; meta:string; database?:string };
type Row = Record<string, unknown>;
const list=(value:unknown):string[]=>{
  if(Array.isArray(value)) return value.map(String).map((tag)=>tag.trim()).filter(Boolean);
  if(typeof value!=="string"||!value.trim()) return [];
  const raw=value.trim();
  if(raw.startsWith("[")){
    try{const parsed=JSON.parse(raw);if(Array.isArray(parsed))return parsed.map(String).map((tag)=>tag.trim()).filter(Boolean);}catch{}
  }
  const content=raw.startsWith("{")&&raw.endsWith("}")?raw.slice(1,-1):raw;
  return content.split(",").map((tag)=>tag.trim().replace(/^["']|["']$/g,"")).filter(Boolean);
};
const text=(value:unknown)=>typeof value==="string"?value:"";
const day=(value:unknown,fallback:unknown)=>{
  const raw=text(value).trim();
  const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const short=raw.match(/^(\d{2})\.(\d{2})\.(\d{2})/);
  if(short)return `20${short[1]}-${short[2]}-${short[3]}`;
  const dotted=raw.match(/^(\d{4})\.\s?(\d{1,2})\.\s?(\d{1,2})/);
  if(dotted)return `${dotted[1]}-${dotted[2].padStart(2,"0")}-${dotted[3].padStart(2,"0")}`;
  return text(fallback).slice(0,10);
};

function mapTags(row:Row,source:InsightSource){
  const rawTopics=list(row.topics??row.topic_tags).filter((tag)=>tag!=="News");
  const rawCompanies=list(row.companies??row.company_tags);
  if(source==="report"&&text(row.item_name))rawCompanies.unshift(text(row.item_name));
  const rawMacro=list(row.macro??row.macro_tags);
  const haystack=[row.title,row.summary,row.ai_summary,row.notes,row.text,row.original_text].map(text).join(" ");
  const extracted=extractMappedTags(haystack);
  const topics=normalizeTopics(rawTopics.length?rawTopics:extracted.topics).slice(0,20);
  const companies=normalizeCompanies(rawCompanies.length?rawCompanies:extracted.companies).slice(0,20);
  const macro=normalizeMacro(rawMacro.length?rawMacro:extracted.macro).slice(0,10);
  return {topics,companies,macro};
}

const stableId=(value:string)=>{
  let hash=2166136261;
  for(let index=0;index<value.length;index+=1){
    hash^=value.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0).toString(36);
};

function liveItem(candidate:LiveInsightCandidate,source:"news"|"report"):InsightItem{
  const itemName=["기타","기타법인","-"].includes((candidate.itemName??"").trim())
    ? ""
    : candidate.itemName??"";
  const row:Row={
    title:candidate.title,
    item_name:itemName,
  };
  const tags=mapTags(row,source);
  const itemDate=day(candidate.publishedDate,"");
  return {
    id:`${source}-live-${stableId(candidate.url)}`,
    source,
    title:candidate.title,
    summary:"",
    notes:"",
    topics:tags.topics,
    companies:tags.companies,
    macro:tags.macro,
    date:itemDate,
    createdAt:itemDate?`${itemDate}T00:00:00+09:00`:"",
    url:candidate.url,
    meta:`실시간 · ${candidate.meta}`,
  };
}

export async function GET(req: NextRequest) {
  const db=getInsightSupabase(req);
  if(!db) return NextResponse.json(insightDbUnavailable(),{status:401});
  const [queries,liveSources] = await Promise.all([
    Promise.all([
    db.from("telegram_saved").select("id,text,summary,notes,topic_tags,company_tags,macro_tags,msg_date,created_at,link,channel").order("created_at",{ascending:false}).limit(1000),
    db.from("news_articles").select("id,title,notes,topic_tags,company_tags,macro_tags,published_date,created_at,url,category").order("created_at",{ascending:false}).limit(1000),
    db.from("report_db").select("id,title,ai_summary,original_text,notes,topic_tags,company_tags,macro_tags,item_name,published_date,created_at,url,broker").order("created_at",{ascending:false}).limit(1000),
    ]),
    loadLiveInsightSources(),
  ]);
  const sources:InsightSource[]=["telegram","news","report"];
  const skippedSources:InsightSource[]=[];
  const items:InsightItem[]=[];
  queries.forEach((result,index)=>{
    const source=sources[index];
    if(result.error){skippedSources.push(source);return;}
    for(const raw of result.data??[]){const row=raw as Row;const tags=mapTags(row,source);items.push({
      id:`${source}-${row.id}`,source,
      title:source==="telegram"?text(row.text).replace(/\s+/g," ").slice(0,80):text(row.title),
      summary:text(row.summary)||text(row.ai_summary)||text(row.notes)||text(row.text).slice(0,400)||text(row.original_text).slice(0,400),
      notes:text(row.notes),topics:tags.topics,companies:tags.companies,macro:tags.macro,
      date:day(row.date??row.msg_date??row.published_date,row.created_at),createdAt:text(row.created_at),url:text(row.link??row.url)||null,
      meta:text(row.channel??row.category??row.broker),
    });}
  });
  const existingUrls=new Set(items.map((item)=>item.url).filter((url):url is string=>Boolean(url)));
  for(const candidate of liveSources.news){
    if(existingUrls.has(candidate.url))continue;
    items.push(liveItem(candidate,"news"));
    existingUrls.add(candidate.url);
  }
  for(const candidate of liveSources.reports){
    if(existingUrls.has(candidate.url))continue;
    items.push(liveItem(candidate,"report"));
    existingUrls.add(candidate.url);
  }
  items.sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const sourceCounts=Object.fromEntries(sources.map((source)=>[source,items.filter((item)=>item.source===source).length]));
  return NextResponse.json({items,skippedSources,sourceCounts,counts:sourceCounts});
}

export async function POST(req: NextRequest) {
  if(!getInsightSupabase(req)) return NextResponse.json(insightDbUnavailable(),{status:401});
  const body=await req.json() as {keyword?:string;items?:Array<{title?:string;summary?:string;date?:string}>;related?:Array<{name:string;count:number}>;monthly?:Array<{month:string;count:number}>};
  const items=(body.items??[]).slice(0,100);if(!items.length)return NextResponse.json({error:"분석할 저장 자료가 없습니다."},{status:400});
  const recent=items.slice(-5).map(item=>item.title||item.summary).filter(Boolean).join(" · ");
  const monthly=(body.monthly??[]).map(row=>`${row.month} ${row.count}건`).join(" → ");
  const related=(body.related??[]).slice(0,8).map(row=>`${row.name}(${row.count})`).join(", ");
  return NextResponse.json({keyword:body.keyword??"",count:items.length,trend:monthly||`저장 자료 ${items.length}건이 축적되었습니다.`,implication:`최근 자료의 핵심 흐름: ${recent}`.slice(0,900),watch:related?`연관 키워드 ${related}의 동반 변화를 확인하세요.`:"추가 자료가 축적될 때 방향성 변화를 확인하세요.",timeline:monthly,relation:related});
}

export async function DELETE(req: NextRequest) {
  const db=getInsightSupabase(req);if(!db)return NextResponse.json(insightDbUnavailable(),{status:401});
  const body=await req.json() as {source?:InsightSource;id?:string};
  const table=body.source&&({telegram:"telegram_saved",news:"news_articles",report:"report_db"} as const)[body.source];
  const id=String(body.id??"").replace(/^[^-]+-/,"");
  if(!table||!id)return NextResponse.json({error:"올바른 source와 id가 필요합니다."},{status:400});
  const {error}=await db.from(table).delete().eq("id",id);
  return error?NextResponse.json({error:formatSupabaseError(error)},{status:500}):NextResponse.json({ok:true});
}
