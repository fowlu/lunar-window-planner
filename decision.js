'use strict';

const LunarDecision = (() => {
  const priorities = {
    blackout: 'shortest Earth blackout',
    earliest: 'earliest Earth sightline',
    sunlight: 'most potential sunlight'
  };
  const hours = minutes => (minutes / 60).toFixed(1) + ' h';

  function firstSightline(earth, start) {
    const possible = earth.rows.find(([, , status]) =>
      status === 'unknown' || status.startsWith('visible'));
    return {lo: possible ? possible[0] - start : null, hi: earth.first};
  }

  function option(site, start, span, earth, sun) {
    return {
      siteId: site.id, name: site.name, start, span,
      earliest: firstSightline(earth, start),
      blackout: {lo: earth.lower, hi: earth.upper},
      sunlight: {lo: sun.visible, hi: sun.visible + sun.unknown},
      earthUnknown: earth.unknown,
      sunUnknown: sun.unknown
    };
  }

  function eligibility(option, deadline) {
    if (deadline === null) return 'eligible';
    const {lo, hi} = option.earliest;
    if (hi !== null && hi <= deadline) return 'eligible';
    return lo === null || lo > deadline ? 'excluded' : 'uncertain';
  }

  function rank(options, priority, deadline, tolerance) {
    const eligible = options.filter(item => eligibility(item, deadline) === 'eligible');
    const uncertain = options.filter(item => eligibility(item, deadline) === 'uncertain');
    if (uncertain.length) return {kind:'indeterminate', reason:'deadline', winner:null};
    if (!eligible.length) return {kind:'none', reason:'deadline', winner:null};
    if (priority === 'earliest' && eligible.every(item => item.earliest.hi === null)) {
      return {kind:'indeterminate', reason:'sightline', winner:null};
    }
    const beats = (a,b) => {
      const {lo, hi} = a[priority], other = b[priority];
      if (priority === 'sunlight') return lo > other.hi + tolerance;
      return (hi ?? Infinity) + tolerance < (other.lo ?? Infinity);
    };
    const winner = eligible.find(item => eligible.every(other => other === item || beats(item,other)));
    return winner ? {kind:'winner', reason:null, winner} : {kind:'indeterminate',reason:'overlap',winner:null};
  }

  function describe(result, priority, deadline) {
    if (result.kind === 'winner') {
      const suffix = deadline === null ? '' : ' with a modeled Earth sightline by '+hours(deadline);
      return result.winner.name+' is favored for '+priorities[priority]+suffix+'.';
    }
    if (result.kind === 'none') return 'No evaluated option has an Earth sightline by '+hours(deadline)+'.';
    if (result.reason === 'deadline') return 'Terrain coverage leaves the report deadline uncertain.';
    if (result.reason === 'sightline') return 'There is no confirmed first Earth sightline to rank within this window.';
    return 'The modeled options overlap or are too close to rank for '+priorities[priority]+'.';
  }

  function display(range, priority) {
    if (priority === 'earliest') {
      if (range.lo === null) return 'None in window';
      if (range.hi === null) return 'Possible from '+hours(range.lo);
      if (Math.abs(range.hi-range.lo) < 1e-7) return range.lo===0?'At touchdown':hours(range.lo);
      return 'Possible from '+hours(range.lo)+' · confirmed by '+hours(range.hi);
    }
    return Math.abs(range.hi-range.lo)<1e-7 ? hours(range.lo) : hours(range.lo)+' – '+hours(range.hi);
  }

  function readQuestion(text, height, priority, deadline) {
    const number = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twelve:12};
    const time = text.match(/\b(?:within|by|in the first|after)\s+(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(hours?|hrs?|h|minutes?|mins?)\b/i);
    const antenna = text.match(/\b(\d+(?:\.\d+)?)\s*(?:m\b|met(?:er|re)s?\b)/i);
    const heightValue=antenna ? Number(antenna[1]) : null;
    const knownHeight=heightValue===2||heightValue===5;
    const earliest=/\b(?:earliest|first|soonest)\b.*\b(?:earth|sightline)\b/i.test(text)&&!time;
    return {
      height: knownHeight?String(heightValue):height,
      invalidHeight: antenna!==null&&!knownHeight,
      matched: Boolean(time||knownHeight||earliest),
      priority: earliest?'earliest':priority,
      deadline: time ? (number[time[1].toLowerCase()] ?? Number(time[1])) * (/^m/i.test(time[2])?1:60) : deadline
    };
  }
  return {priorities,hours,option,rank,describe,display,eligibility,readQuestion};
})();

if (typeof module !== 'undefined') module.exports = LunarDecision;
