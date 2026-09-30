// "Open <something> website": which search result JARVIS opens (NLU.bestResult). The result lists are real Bing
// results captured on 2026-09-30 for the phrases that went wrong. Run: node tests/websearch.test.js
'use strict';
const fs = require('fs'), path = require('path');
const { suite, ROOT } = require('./lib/server');
eval(fs.readFileSync(path.join(ROOT, 'nlu.js'), 'utf8') + ';global.NLU=NLU;');
const { check, done } = suite('websearch');
const R = (title, url) => ({ title, url });
const pick = (q, list) => { const b = NLU.bestResult(list, q); return b ? b.url : null; };

// The reported bug: Atria Institute of Technology opened for "atria university website".
const ATRIA = [R('Atria Institute of Technology | Adjacent Bangalore Baptist Hospital ...', 'https://atria.edu.in/'),
  R('Atria Institute of Technology | Adjacent Bangalore Baptist Hospital ...', 'https://atria.edu.in/admissions/'),
  R('Atria.com', 'https://www.atria.com/en/'), R('Shipping winning Meta ads | Atria', 'https://www.tryatria.com/'),
  R('Private Engineering Colleges In Bangalore | Atria University', 'https://www.atriauniversity.edu.in/'),
  R('Atria Institute of Technology Bangalore: Admission 2026', 'https://collegedunia.com/college/12906-atria-institute-of-technology-bangalore')];
check('Search', '"atria university website" opens Atria University, not Atria Institute', pick('atria university website', ATRIA) === 'https://www.atriauniversity.edu.in/', pick('atria university website', ATRIA));
check('Search', '"atria institute of technology" still opens Atria Institute', pick('atria institute of technology', ATRIA) === 'https://atria.edu.in/');

// A listing site never beats the official site that matches as well.
const RV = [R('RV College of Engineering', 'https://rvce.edu.in/'), R('R V College of Engineering (RVCE) Bangalore: Admission 2026', 'https://collegedunia.com/college/14673-r-v-college-of-engineering-rvce-bangalore')];
check('Search', 'the official site beats a college-listing site', pick('rv college of engineering', RV) === 'https://rvce.edu.in/');
check('Search', 'the search engine’s first result stays when it matches everything', pick('iit bombay', [R('IIT Bombay', 'https://www.iitb.ac.in/'), R('ACR | IIT Bombay', 'https://acr.iitbombay.org/')]) === 'https://www.iitb.ac.in/');

// Results that don't mention the NAME are never opened — JARVIS asks instead.
check('Search', 'a result matching only "university" is not opened (Lucknow University for "reva")', pick('reva university website', [R('University of Lucknow', 'https://www.lkouniv.ac.in/')]) === null);
check('Search', 'website-builder pages for "… website" are not opened', pick('smart india hackathon website', [R('Website Builder - Create a Free Website | Wix.com', 'https://www.wix.com/'), R('Website Builder | Canva', 'https://www.canva.com/website-builder/')]) === null);
check('Search', 'unrelated colleges for "dayananda sagar college" are not opened', pick('dayananda sagar college', [R('Collegedunia: Top Colleges, Universities & Institutes in India', 'https://collegedunia.com/'), R('PSNA COLLEGE OF ENGINEERING AND TECHNOLOGY', 'https://www.psnacet.edu.in/')]) === null);
check('Search', 'the retry with just the name finds Reva', pick('reva university', [R('REVA University', 'https://www.reva.edu.in/')]) === 'https://www.reva.edu.in/');
check('Search', 'a specific page still wins (LeetCode Two Sum)', pick('leetcode two sum', [R('Two Sum - LeetCode', 'https://leetcode.com/problems/two-sum/'), R('LeetCode', 'https://leetcode.com/')]) === 'https://leetcode.com/problems/two-sum/');

// Words stripped before matching known sites.
check('Known sites', '"the official leetcode website" → "leetcode"', NLU.bareSiteName('the official leetcode website') === 'leetcode');
check('Known sites', '"smart india hackathon website" → "smart india hackathon"', NLU.bareSiteName('smart india hackathon website') === 'smart india hackathon');
process.exit(done() ? 1 : 0);
