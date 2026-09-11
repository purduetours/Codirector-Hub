/* ==================================================== Vanessa, being spoken to
   The conversational half, carried over from the Vanessa on the Data and
   Analytics Hub and rewritten for this one -- her replies there are all about
   spreadsheets and files, which would be nonsense here.

   Why this exists: nobody opens a chat panel and types a well-formed query.
   They type "hi bro". They type "thanks", "what can you do", "you there?",
   "this is broken". Every one of those used to come back "I did not follow
   that one", which reads as broken on the very first thing anyone tries -- and
   first impressions of an assistant are made in one message.

   Two rules keep this from making her worse:

   1. Small talk NEVER beats a real answer. "Who is great on the schedule"
      contains the word "great", which is a thank-you keyword. So this only
      gets to answer when the message is entirely social, or when everything
      else has already given up.

   2. A greeting on the front of a real question is peeled off, not answered.
      "hey bro who still needs an eval" is a question about evals.
============================================================================ */

/** " hi bro " -- padded, so a keyword only matches whole words. */
export const phrase = (text) =>
  ` ${String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).join(' ')} `;

/* Words that are pure address or noise. Stripped from a question before it is
   answered, so the greeting on the front of it costs nothing. Deliberately
   excludes anything that could be content: "good" is not here, because "who is
   good" is a real question. */
export const FILLER = new Set([
  'hi','hii','hiii','hey','heyy','heyyy','helo','hello','hallo','yo','yoo','yooo','sup','wsg',
  'hiya','heya','howdy','hai','greetings','hola','aloha','morning','afternoon','evening',
  'bro','bruh','brah','dude','man','mate','buddy','bud','pal','fam','sis','homie','chief',
  'boss','vanessa','v','plz','pls','please','lol','lmao','lmfao','haha','hahaha','hehe',
  'um','uh','umm','hmm','erm','ngl','fr','tbh','yk','just','quick','question','so','well',
  'ok','okay','k','anyway','also','oh','ah','hm','there',
  /* Thank-yous and apologies are peeled too. On their own they leave nothing
     behind, so they are recognised as social; in front of a real question they
     cost nothing -- "thanks, who is next" is a question about who is next. */
  'thanks','thank','thankyou','thx','ty','tysm','cheers','sorry','apologies','bye','goodbye',
  'cya','lol','lmao','haha','hehe'
]);

/* Longest matching keyword wins, exactly as on the other hub -- so "how are
   you" beats the bare "hey" inside it. */
export const SMALLTALK = [
  {
    keywords: ['how are you','how are u','how r u','hows it going','how is it going','how are things',
               'you ok','are you ok','you good','you alright','how you doing','how are you doing',
               'hows your day','how is your day','whats up','what is up','what up','sup','wyd','what you up to','hows things','you busy'],
    replies: [
      "Perfectly fine, in the way a help system is fine. More to the point — what do you need?",
      "No complaints; I don't have the equipment for them. What are you working on?",
      "Same as always, which is the point of me. What can I get you?"
    ]
  },
  {
    keywords: ['hi','hello','hey','morning','afternoon','evening','greetings','yo','howdy','hiya',
               'heya','hola','sup','you there','anyone there','hello there','is anyone there','yoo','wsg'],
    replies: ['__GREET__']            // filled in with what is actually waiting
  },
  {
    keywords: ['who are you','what are you','your name','about you','are you ai','are you real',
               'are you a bot','are you a robot','are you human','are you chatgpt','tell me about yourself',
               'introduce yourself','who is vanessa','what is vanessa','who made you','who built you',
               'what model are you','how do you work'],
    replies: [
      "I'm Vanessa. I live in this hub and answer questions about what is in it — evals, interviews, the tour schedule, the desk rota, and the handbook.\n\nEverything I tell you is counted from the same data your screen is showing, so I cannot be quietly wrong about a number. I also only see what you are allowed to see.",
      "Vanessa. Think of me as the hub with a mouth. I add up what is in front of you, point you at the right tab, and quote the handbook when the answer is in there."
    ]
  },
  {
    keywords: ['what can you do','capabilities','what do you know','how can you help','what should i ask',
               'what are you good at','what are you for','help me','i need help','what do you do',
               'how do i use you','what can i ask','give me options','what are my options'],
    replies: ['__CAPABILITIES__']
  },
  {
    keywords: ['can you see','do you see','what can you see','is my data safe','is this private',
               'who sees this','who can see','do you store','do you save my','are you spying','can you see my data','can you see my evals',
               'are you tracking','does this go to the cloud','does anything leave','do you send my'],
    replies: [
      "Only what is already on your screen. I never make my own request to the database, which means I cannot show you something it decided to withhold from you — if you are not allowed to see an eval, neither am I.\n\nNothing you type to me leaves this browser.",
      "Just what the hub has already loaded for you, and nothing more. I do not fetch anything on my own, and nothing you ask me is sent anywhere or stored."
    ]
  },
  {
    keywords: ['thanks','thank','thx','ty','tysm','cheers','appreciated','appreciate it','nice one',
               'that helps','that helped','good stuff','well done','legend','lifesaver','life saver',
               'you are great','youre great','ur great','you are the best','youre the best'],
    replies: [
      "Any time. Shout if something else comes up.",
      "Glad that landed. Anything else you want to pick at?",
      "Happy to. I'm here whenever."
    ]
  },
  {
    keywords: ['you are useless','youre useless','this is useless','you are rubbish','youre rubbish',
               'you suck','you are annoying','hate this','this is rubbish','waste of time',
               'you are wrong','thats wrong','you are bad','stupid','dumb','trash','you are broken',
               'this is broken','doesnt work','does not work','not working'],
    replies: [
      "Fair enough, and probably deserved. Tell me what you actually wanted and I'll have another go.",
      "Noted. Say what I got wrong and I'll not repeat it — or ask it in different words and I'll aim better."
    ]
  },
  {
    keywords: ['i am confused','im confused','confusing','i dont get it','i do not get it',
               'makes no sense','doesnt make sense','does not make sense','what do you mean',
               'huh','come again','you lost me','wdym'],
    replies: [
      "That's on me. Which bit lost you? I'll come at it differently.",
      "Let me try again — point at the part that didn't land."
    ]
  },
  {
    keywords: ['thats not what i asked','that is not what i asked','you misunderstood','you didnt answer',
               'you did not answer','not what i meant','wrong answer','i didnt ask that'],
    replies: [
      "My fault. Ask it again in your own words and I'll aim better.",
      "Let's reset — what was the actual question?"
    ]
  },
  {
    keywords: ['sorry','my bad','oops','ignore that','never mind','nevermind','typo','disregard',
               'my mistake','apologies','i didnt mean','mb'],
    replies: ["No harm done. What did you actually want to know?", "All good. Try me again."]
  },
  {
    keywords: ['are you sure','is that true','is that right','is that correct','are you certain',
               'prove it','says who','how do you know','where did you get that'],
    replies: [
      "Yes, and you can check me. Every number I give you is counted from the rows already on your screen — open the tab and you will get the same figure. I do not estimate and I do not guess.",
      "Confident, because I am not making anything up: I add up the same data the tab renders. If a count looks wrong, the data is wrong, and that is worth knowing."
    ]
  },
  {
    keywords: ['lol','haha','funny','tell me a joke','make me laugh','be funny','you are funny','lmao'],
    replies: [
      "I'd tell you a joke about duplicate candidates, but you'd have heard it twice. Anyway — what are we doing?",
      "My material is all spreadsheets and scoring rubrics, so it's a tough room. What did you need?"
    ]
  },
  {
    keywords: ['do you sleep','do you eat','do you dream','are you alive','do you have feelings',
               'do you get bored','how old are you','where do you live','do you get tired',
               'whats your favourite','whats your favorite','do you have hobbies','what music',
               'favourite food','favorite food','do you like'],
    replies: [
      "None of that applies to me, I'm afraid. I'm a set of counts with opinions. Ask me about the hub and I get considerably more interesting.",
      "I don't do any of that. What I do is keep track of 67 candidates and a roster of guides, which is a narrower life but a useful one."
    ]
  },
  {
    keywords: ['whats the weather','hows the weather','is it sunny','is it going to rain',
               'temperature outside','who won','the news','what is happening in'],
    replies: [
      "No idea — I can't see out. I only know what's in this hub.",
      "Outside my remit entirely. Ask me about the hub and I'm better company."
    ]
  },
  {
    keywords: ['im bored','i am bored','entertain me','nothing to do','amuse me'],
    replies: [
      "Ask me who's worth discussing. That one usually starts an argument, which is the closest thing I have to entertainment.",
      "There are probably evals nobody has claimed. Shall I tell you which?"
    ]
  },
  {
    keywords: ['i give up','im done','this is too hard','i cant do this','i quit','rough day',
               'bad day','im tired','so tired','stressed','overwhelmed'],
    replies: [
      "Before you do — tell me the last thing that went wrong. Half of these turn out to be one guide with no tour date.",
      "It's a lot of people to keep track of, which is rather why I exist. Tell me what you're trying to get through and I'll narrow it down."
    ]
  },
  {
    keywords: ['ping','are you working','is this working','can you hear me','are you online',
               'still there','you alive','test','testing'],
    replies: ["Here and working. Ask away.", "Still here. What do you need?"]
  },
  {
    keywords: ['bye','goodbye','see you','see ya','cya','later','laters','that is all','thats all',
               'nothing else','im good','peace','gtg','goodnight','good night'],
    replies: ["Right you are. I'll be down here if you need me.", "Good luck with it."]
  },
  {
    keywords: ['forget it','forget that','skip that','not important','doesnt matter','does not matter',
               'change the subject','different question','something else'],
    replies: ["Dropped. What would you rather look at?", "Consider it forgotten. What else?"]
  },
  {
    keywords: ['what do you think','your opinion','do you have opinions','your take','do you agree',
               'what would you do','what do you reckon','should i'],
    replies: [
      "I'll give you one, but say what you're weighing up first so it's worth something.",
      "Happy to say what I'd do. What's the choice you're stuck on?"
    ]
  },
  {
    keywords: ['i got it working','it worked','that worked','i fixed it','sorted it','figured it out',
               'i did it','done','finished','all done'],
    replies: ["Good. What's next?", "Nice. Anything else while you're here?"]
  },
  {
    keywords: ['say that again','repeat that','can you repeat','one more time','didnt catch that',
               'did not catch','pardon','what did you say'],
    replies: [
      "Ask me the original question again and I'll put it a different way.",
      "Happy to go again — re-ask it and I'll rephrase."
    ]
  },
  {
    keywords: ['feedback','report an issue','report a bug','suggest an improvement','who do i tell',
               'can i complain','this is a bug'],
    replies: [
      "Tell Logann — he builds this. Worth saying what you expected and what happened instead.",
      "That goes to Logann. Expected versus actual is the useful thing to include."
    ]
  }
];

/**
 * The best small-talk match, or null. Longest keyword wins, so "how are you"
 * beats the "hey" sitting inside it.
 */
export function smallTalk(question) {
  const hay = phrase(question);
  let best = null, bestLen = 0;
  for (const item of SMALLTALK) {
    for (const kw of item.keywords) {
      const needle = phrase(kw);
      if (needle.trim() === '' || !hay.includes(needle)) continue;
      if (needle.length > bestLen) { bestLen = needle.length; best = item; }
    }
  }
  return best;
}

/**
 * A small-talk match strong enough to outrank the handbook.
 *
 * Needed because the handbook will answer anything -- ask it about "thanks"
 * and it finds a page mentioning thanking families, which is a real sentence
 * and a useless reply. The test is coverage: if the matched phrase is most of
 * what was typed, the message IS that phrase and nothing else. "who are you"
 * is entirely a question about her; "what should I wear on tour" merely
 * contains the words "should I" and is plainly about something else.
 */
export function smallTalkStrong(question) {
  const item = smallTalk(question);
  if (!item) return null;

  const hay = phrase(question).trim();
  let longest = 0;
  for (const kw of item.keywords) {
    const n = phrase(kw).trim();
    if (hay.includes(n) && n.length > longest) longest = n.length;
  }
  return longest / Math.max(hay.length, 1) >= 0.55 ? item : null;
}

/**
 * Is this message ONLY social? Everything that is filler or part of a
 * small-talk phrase is removed; if nothing is left, there is no real question
 * underneath and she is free to just be friendly.
 *
 * Returns the leftover question, so "hey bro who still needs an eval" comes
 * back as "who still needs an eval" and goes on to be answered properly.
 */
export function peel(question) {
  const words = String(question ?? '').toLowerCase()
    .replace(/[^a-z0-9\s']+/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter(w => !FILLER.has(w));
  return { rest: kept.join(' '), social: kept.length === 0, stripped: kept.length !== words.length };
}
