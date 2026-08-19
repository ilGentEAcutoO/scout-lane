export type OfficialLink = { id: string; label: string; url: string };

/** Official people-search landings HR clicks. Never fetched by adapters. */
export const PEOPLE_SEARCH_IDS = [
  "linkedin",
  "jobsdb_people",
  "jobthai_resume",
  "jobbkk_resume",
  "hosco",
  "jobtopgun",
  "seek_talent",
] as const;

export function officialSearchUrls(query: string, location = "Bangkok"): OfficialLink[] {
  const raw = query.trim() || "Tech Lead AI Workflow";
  const q = encodeURIComponent(raw);
  const loc = encodeURIComponent(location);
  return [
    { id: "linkedin", label: "LinkedIn People", url: `https://www.linkedin.com/search/results/people/?keywords=${q}` },
    {
      id: "jobsdb_people",
      label: "JobsDB People",
      url: `https://th.jobsdb.com/profiles/search?keywords=${q}`,
    },
    { id: "jobthai_resume", label: "JobThai ค้นประวัติ", url: "https://www.jobthai.com/th/search-resume" },
    { id: "jobbkk_resume", label: "JobBKK Resume Search", url: "https://jobbkk.com/resumes/lists" },
    { id: "hosco", label: "Hosco", url: "https://www.hosco.com/en/" },
    { id: "jobtopgun", label: "JobTOPGUN", url: "https://www.jobtopgun.com/th" },
    { id: "seek_talent", label: "SEEK Talent Search", url: "https://th.employer.seek.com/" },
    { id: "jobsdb", label: "JobsDB ใบงาน", url: `https://th.jobsdb.com/${q}-jobs` },
    { id: "jobthai", label: "JobThai ใบงาน", url: `https://www.jobthai.com/th/jobs?keyword=${q}` },
    { id: "jobbkk", label: "JobBKK ใบงาน", url: `https://www.jobbkk.com/jobs/lists/${q}` },
    { id: "facebook", label: "Facebook", url: `https://www.facebook.com/search/posts/?q=${q}` },
    { id: "meetup", label: "Meetup / GDG", url: `https://www.meetup.com/find/?keywords=${q}&location=${loc}` },
    { id: "blognone", label: "Blognone", url: `https://www.google.com/search?q=site%3Ablognone.com+${q}` },
    { id: "wellfound", label: "Wellfound", url: `https://wellfound.com/jobs?q=${q}` },
    { id: "x", label: "X", url: `https://x.com/search?q=${q}&src=typed_query` },
    { id: "stackoverflow", label: "Stack Overflow", url: `https://stackoverflow.com/search?q=${q}` },
    { id: "sessionize", label: "Sessionize speakers", url: `https://sessionize.com/app/search?term=${q}` },
    { id: "gdg", label: "GDG Bangkok", url: `https://gdg.community.dev/gdg-bangkok/` },
    { id: "thaiprogrammer", label: "Thai Programmer", url: `https://www.google.com/search?q=${q}+site%3Athaiprogrammer.org` },
    {
      id: "personal_sites",
      label: "พอร์ตส่วนตัว",
      url: `https://www.google.com/search?q=${encodeURIComponent(`"${query.trim() || "full-stack engineer"}" Bangkok (portfolio OR "about me" OR ประวัติ) -linkedin -jobsdb -jobthai`)}`,
    },
    {
      id: "devhub_dir",
      label: "DevHub directory",
      url: "https://devhub.in.th/en/developers/roles/full-stack-developers/",
    },
    { id: "codeberg", label: "Codeberg", url: `https://codeberg.org/explore/users?q=${q}` },
    { id: "remoteok", label: "RemoteOK", url: `https://remoteok.com/remote-${q}-jobs` },
    { id: "remotive", label: "Remotive", url: `https://remotive.com/remote-jobs/search?search=${q}` },
    { id: "weworkremotely", label: "We Work Remotely", url: `https://weworkremotely.com/remote-jobs/search?term=${q}` },
    { id: "hnjobs", label: "HN Who is hiring", url: `https://hn.algolia.com/?q=${q}+hiring` },
    { id: "redditjobs", label: "Reddit forhire", url: `https://www.reddit.com/r/forhire/search/?q=${q}` },
    { id: "medium", label: "Medium", url: `https://medium.com/search?q=${q}` },
    { id: "langchainhub", label: "LangChain smith", url: `https://smith.langchain.com/hub?q=${q}` },
    { id: "mcpgithub", label: "Awesome MCP", url: `https://github.com/search?q=${q}+mcp+server&type=repositories` },
    { id: "kaggle", label: "Kaggle", url: `https://www.kaggle.com/search?q=${q}` },
    { id: "paperswithcode", label: "Papers with Code", url: `https://paperswithcode.com/search?q=${q}` },
  ];
}
