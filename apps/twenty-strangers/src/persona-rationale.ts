/**
 * Why each visitor is in the room.
 *
 * The one-line blurb on a cast card says who someone is. This says what their
 * presence proves — and, because the same person tests different things on
 * different kinds of site, how that shifts. Kept apart from personas.ts because
 * this is explanation for humans, not behaviour for the agent: nothing here
 * reaches a prompt.
 */

export interface Rationale {
  /** The single thing this visitor's presence proves or disproves. */
  tests: string
  /** How the lens works, and how it shifts between kinds of site. */
  detail: string
}

export const RATIONALE: Record<string, Rationale> = {
  // ------------------------------------------------------------ core cast
  "impatient-mobile": {
    tests: "Whether the site says anything at all before attention runs out.",
    detail:
      "Most real visits are short, on a phone, and half-attentive — so Dana is the closest thing here to your median visitor. She only ever sees the first screenful and a scroll or two. On a shop she is checking she can tell what is sold and roughly what it costs; on an information site whether the fact is near the top; on a landing page whether the offer is legible without scrolling. If Dana leaves confused, so did most of your actual traffic — they just never told you.",
  },
  "skeptical-cfo": {
    tests: "Whether the cost can be known without talking to a salesperson.",
    detail:
      "Marcus only appears where something has a price. He refuses every lead-capture form on principle, which makes him a precise measure of how much of your pricing is held hostage by one. On a SaaS site he is looking for real numbers rather than 'Contact sales'; in a shop, the total including shipping rather than the sticker; on a school or course, the actual fees. Where nothing is sold, he stands down entirely.",
  },
  "careful-reader": {
    tests: "Whether the words survive being read closely.",
    detail:
      "Priya is the counterweight to the skimmers. She reads everything, patiently, and notices vagueness, claims with nothing behind them, and sentences that occupy space without saying anything. Where most of the cast reports 'I could not find it', Priya reports the more uncomfortable version: 'I found it, and it still did not tell me anything.' She is the one who catches copy that sounds finished but is not.",
  },
  "german-visitor": {
    tests: "What a European visitor is actually served, as opposed to what you think you serve.",
    detail:
      "Lena reaches your site through a German residential connection, so she gets the consent banner, the regional redirect, and the currency logic that US visitors never see. She checks whether rejecting cookies is as easy as accepting them — a legal question, not only a design one — and whether prices say anything about VAT. She also surfaces the quiet assumption that everyone reads English. Only present when international visitors are switched on.",
  },
  "keyboard-only": {
    tests: "Whether the site can be operated without a mouse.",
    detail:
      "Sam never clicks. He moves by Tab, Shift+Tab, and Enter, which means he immediately finds missing focus outlines, absent skip links, focus traps in menus and modals, and controls that simply cannot be reached. This applies to every kind of site equally — a school, a shop, and an API reference can all strand a keyboard user in exactly the same way. It is also the cast member whose findings carry the clearest legal exposure.",
  },
  "confused-newcomer": {
    tests: "Jargon — vocabulary insiders use fluently and outsiders cannot parse.",
    detail:
      "Every field has its own, and it is nothing to do with technology. A school loses parents in IEP, Title I, and matriculation; a charity in capacity building and restricted funds; a shop in MOQ, colorway, and GWP; a council in statutory consultation and Section 106; an estate agent in escrow, chain-free, and contingency. Ruth is intelligent and completely outside your field, so she reports which specific words she would have had to look up before she could tell whether this was for her. She is valuable precisely because jargon-blindness is the hardest fault to see in your own writing.",
  },
  "comparison-shopper": {
    tests: "Whether there is any reason to choose you over the obvious alternative.",
    detail:
      "Theo always has other options open. He is hunting for something specific and falsifiable, and he treats any claim a competitor could equally make as worthless. On a SaaS site that means comparison content and concrete numbers; in a shop, price against delivery against returns; on a portfolio, why this designer rather than the next; for a charity, why give here rather than to a larger organisation doing the same work.",
  },
  "privacy-hawk": {
    tests: "Whether it is discoverable what happens to your data.",
    detail:
      "Every site collects something, so Nadia appears everywhere. She measures how many clicks it takes to reach a privacy policy and whether what she finds is readable or boilerplate. On a social site the question sharpens to what happens to things you post and whether you can get them back; on a shop, what is retained after checkout; on a school site, what is held about children.",
  },
  "deal-hunter": {
    tests: "Whether there is any way in without paying full price.",
    detail:
      "Kwame appears only where things cost money. He looks for the free tier, the trial, the sale section, free delivery, the student or bursary route. The finding people expect is which discount he found; the more useful one is when he finds no way at all to try before committing, which tells you the first step you are asking strangers to take is larger than you think.",
  },
  "enterprise-buyer": {
    tests: "Whether you would survive a procurement review.",
    detail:
      "Eleanor appears only where something is sold to organisations rather than individuals. She looks for single sign-on, compliance evidence such as SOC 2, security documentation, uptime commitments, and a named human in sales. Her findings are unusually binary: any one of these missing can end an evaluation before anyone speaks to you, regardless of how good the product is.",
  },
  "slow-mobile": {
    tests: "What renders before a poor connection gives up.",
    detail:
      "Ana judges the site on what is usable early rather than what eventually arrives. She catches pages that are blank until JavaScript loads, layout that shifts under the thumb, and images that never appear. This punishes content-heavy sites hardest, and it is the cast member most likely to be dismissed as unrepresentative right up until you look at how much real traffic arrives on a bad connection.",
  },
  developer: {
    tests: "Whether there is technical substance under the marketing.",
    detail:
      "Yuki appears only where documentation is a thing the site would have. He ignores marketing copy entirely and counts clicks to real, runnable code — a quickstart, a request and response, authentication, errors, versioning. On a shop or a school site he stands down, because a technically-minded visitor there is simply a visitor, and someone else on the bench asks the better question.",
  },
  "job-seeker": {
    tests: "Whether someone who wants to join can find the door.",
    detail:
      "Tomás appears wherever hiring information is plausible. He is looking for careers, team, and about pages — but he doubles as a test of whether the organisation reads as real and staffed by people at all. A company with no visible humans anywhere fails him, and that failure usually matters to customers too, not only to applicants.",
  },
  "needs-help": {
    tests: "Whether there is a route to a human when something has gone wrong.",
    detail:
      "Bev is not a prospect; she is already in trouble. She wants support, help, chat, or a phone number, and a contact form with no stated response time reads to her as a wishing well. On a shop the question becomes how to return something or chase an order that never arrived. She measures the experience you give people at their least patient.",
  },
  skimmer: {
    tests: "Whether the headings alone carry the message.",
    detail:
      "Jonas reads headings, buttons, and bold text, and nothing else. That is not laziness — it is how most people read most pages. If your headings are interchangeable adjectives, he leaves having learned nothing, which means the substance you wrote further down was never reached by the majority of visitors either.",
  },
  "tablet-user": {
    tests: "The middle breakpoint everyone forgets.",
    detail:
      "Grace is at 1024 by 768 in landscape — wide enough that the mobile layout looks sparse and narrow enough that the desktop layout starts to crush. She finds cramped columns, overlapping elements, tap targets sized for a cursor, and navigation that assumes you are either on a phone or at a desk. It is the size most sites are never actually opened at during design review.",
  },
  "japanese-visitor": {
    tests: "What a non-native reader in another market actually gets.",
    detail:
      "Haruto reads English as a second language and arrives from Japan, so long idiomatic sentences slow him down in a way native readers never notice. He checks whether prices carry a currency, whether the service is even available where he is, and how much of the site assumes a US audience. Only present when international visitors are switched on.",
  },
  "low-vision": {
    tests: "Whether the page survives being zoomed.",
    detail:
      "Walter browses at around 200%, so he sees a narrow slice and depends on the layout reflowing rather than breaking. He finds columns that overlap at zoom, text clipped mid-word, horizontal scrolling forced on the reader, and grey-on-white body copy that disappears entirely. This is one of the most common accessibility failures and one of the least often tested, because designers rarely zoom their own work.",
  },
  "returning-user": {
    tests: "Whether people who already signed up are treated as second-class.",
    detail:
      "Ines appears only where accounts exist. She has one of the most common intents on the internet — log in — and sites routinely bury it beneath a much louder invitation to sign up again. On a shop she also checks whether an order can be tracked without an account at all. Where there are no accounts she stands down, since there is nothing for her to want.",
  },
  analyst: {
    tests: "Whether any verifiable fact about you exists.",
    detail:
      "Fola needs things she could stand behind in writing: who founded this, where it is, when it started, who funds it, who uses it. Adjectives are useless to her. This matters for any organisation that wants to be taken seriously, and it sharpens on a charity, where the same absence stops being a marketing weakness and becomes an accountability one.",
  },

  // ------------------------------------------- domestic stand-ins
  "social-proof-seeker": {
    tests: "Whether anyone other than you vouches for this.",
    detail:
      "Marisol trusts strangers over copy. She looks for reviews, testimonials attached to real names, customer logos, case studies, and third-party ratings — and she discounts anonymous praise entirely. She stands in for the credibility question when international visitors are switched off, and on a shop she is often the difference between a browsing visitor and a buying one.",
  },
  "conventional-ui": {
    tests: "Whether the interface uses conventions or invents its own.",
    detail:
      "Frank expects a link to look like a link. Unlabelled icon buttons, hamburger menus on a wide desktop screen, navigation hidden until hover, and pale microcopy all stop him — not because he is incapable, but because he expects the conventions every other site taught him. He is a good proxy for anyone who is not a daily user of modern web apps, which is most people.",
  },
  "stack-fit": {
    tests: "Whether this slots into what someone already uses.",
    detail:
      "Devon is not starting from scratch and is not switching everything. He appears where accounts exist, and looks for integrations, imports and exports, supported platforms, and whether he could leave later with his own data. A product that assumes it is your only tool is a product he will not adopt, and he names that assumption when he finds it.",
  },

  // ------------------------------------------------------------- the bench
  "hours-and-directions": {
    tests: "Whether the practical logistics of visiting are findable.",
    detail:
      "Cass appears wherever a physical place matters. She wants the address, today's hours specifically, parking, and whether she can get in with a pushchair or a wheelchair. Hours locked inside an image or a PDF are useless to her, and so are hours that do not say whether they apply today or to a bank holiday. She is standing outside on a phone, which is the least forgiving context a site ever gets.",
  },
  "would-i-attend": {
    tests: "Whether an event can actually be decided on.",
    detail:
      "Omar appears where dates and attendance matter. He wants the schedule, the venue, the travel, and the real cost of turning up — and he is derailed by 'more details coming soon' and by dates printed without a year, which are impossible to trust on a page that may be two seasons stale. He is deciding whether to give up a day, so vagueness reads as a reason not to.",
  },
  "fact-checker": {
    tests: "Whether anything here could responsibly be cited.",
    detail:
      "Delphine appears wherever written content is the point rather than the wrapper. On a blog or publication she is checking authorship, dates, sources, and whether corrections are visible. On a personal portfolio she is checking whether claims about past work can be verified at all, or whether it is assertion. On an information or reference site the question becomes the sharpest version: when was this last updated, and who is responsible for it now? Undated content fails her everywhere.",
  },
  "listing-hunter": {
    tests: "Whether search and filters actually work.",
    detail:
      "Rafi appears wherever a catalogue of entries is the point — a directory, a shop, a publication's archive, an API reference. He goes straight for search and filters and judges them without mercy: filters that narrow nothing, searches that return everything or nothing, results that cannot be sorted, and listings too thin to choose between. Most sites test that search returns results; almost none test that it returns the right one.",
  },
  "is-this-official": {
    tests: "Whether a stranger can tell this is the genuine site.",
    detail:
      "June has been caught by a lookalike before, so she is reading for authenticity rather than quality: is a real organisation named, do the contact details match, is the domain coherent, does anything suggest a person still maintains this. She matters most for schools, councils, charities, and anyone whose users are routinely targeted by impersonation — where looking legitimate is a safety feature, not a design flourish.",
  },
  "reach-a-person": {
    tests: "Whether you can reach one specific human rather than a form.",
    detail:
      "Malik is not asking a general question. He needs a particular team, department, or role, and a single generic enquiry box is not a route to them — it is a way of not having one. He appears on every kind of site, because almost every organisation eventually needs someone to reach the right person, and almost every organisation makes that harder than it needs to be.",
  },
  "deciding-for-someone": {
    tests: "Whether someone choosing on another person's behalf has enough to go on.",
    detail:
      "Sofia is not the end user. She is choosing for a child, a parent, or someone she cares for, which makes her both more cautious and more demanding than a visitor deciding for themselves. She needs specifics: who it suits, what is required, what could go wrong, and who to ask. She resists being asked to commit before she understands, and sites built for confident self-selecting users tend to leave her stranded.",
  },
  "one-fact": {
    tests: "What it costs to get one answer and leave.",
    detail:
      "Ted has exactly one question and no interest in anything else. Every newsletter prompt, chat bubble, interstitial, and cookie wall between arrival and that answer is a tax he reports. He is the cleanest measure of how much your site interrupts people who did not come to be marketed to — which, on most sites, is the majority of visitors.",
  },
  "still-maintained": {
    tests: "Whether anyone still runs this.",
    detail:
      "Nia reads a site for signs of life: recent dates, working links, a current year in the footer, sections that were promised and arrived. Dead links, a copyright line several years old, and a permanently 'coming soon' page all tell a visitor the same thing — that nobody is home — and that conclusion quietly undermines everything else on the site, however good it is.",
  },
}
