const QUO_USERS = {
    'US7ohaVejc': 'Danielle Malik',
  };
  
  const QUO_NUMBERS = ['+15106215939']; // add any other Quo numbers here
  
  export default {
    async fetch(request, env) {
  
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
  
      const payload = await request.json();
      const eventType = payload.type;
      const obj = payload.data?.object;
  
      console.log('Quo event received:', eventType);
  
      let notes, phoneNumber, quoUserId, activityDate;
  
      if (eventType === 'call.completed') {
        const direction = obj.direction === 'incoming' ? 'Inbound' : 'Outbound';
        const duration = obj.duration ? `${Math.round(obj.duration)}s` : 'unknown duration';
        notes = `${direction} call · ${duration}`;
        phoneNumber = obj.direction === 'incoming' ? obj.from : obj.to;
        quoUserId = obj.userId;
        activityDate = obj.createdAt;
  
      } else if (eventType === 'call.summary.completed') {
        notes = `AI Summary: ${obj.summary}`;
        phoneNumber = obj.phoneNumber;
        quoUserId = obj.userId;
        activityDate = obj.createdAt;
  
      } else if (eventType === 'call.transcript.completed') {
        const dialogue = obj.dialogue || [];
        const transcriptText = dialogue
          .map(line => {
            const speaker = QUO_NUMBERS.includes(line.identifier) ? 'RTR' : 'Caller';
            return `${speaker}: ${line.content}`;
          })
          .join('\n');
  
        notes = `Transcript:\n${transcriptText}`;
        phoneNumber = obj.dialogue
          ?.map(line => line.identifier)
          .find(id => !QUO_NUMBERS.includes(id));
        quoUserId = obj.userId;
        activityDate = obj.createdAt;
  
        if (!phoneNumber) {
          console.log('No phone number found in transcript');
          return new Response('OK', { status: 200 });
        }
  
      } else if (eventType === 'message.received') {
        notes = `Inbound text: ${obj.body}`;
        phoneNumber = obj.from;
        quoUserId = obj.userId;
        activityDate = obj.createdAt;
  
      } else if (eventType === 'message.delivered') {
        notes = `Outbound text: ${obj.body}`;
        phoneNumber = obj.to;
        quoUserId = obj.userId;
        activityDate = obj.createdAt;
  
      } else {
        console.log('Unhandled event type:', eventType);
        console.log('Raw payload:', JSON.stringify(payload));
        return new Response('OK', { status: 200 });
      }
  
      // --- Look up Person by phone number ---
      const encodedPhone = phoneNumber.replace('+', '%2B');
      const searchUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/People` +
        `?filterByFormula={Ph E.164}="${encodedPhone}"&maxRecords=1`;
  
      const searchRes = await fetch(searchUrl, {
        headers: { Authorization: `Bearer ${env.AIRTABLE_API_KEY}` }
      });
      const searchData = await searchRes.json();
  
      if (!searchData.records || searchData.records.length === 0) {
        console.log('No person found for phone:', phoneNumber);
        return new Response('OK', { status: 200 });
      }
  
      const personRecordId = searchData.records[0].id;
      console.log('Matched person:', personRecordId);
  
      const quoUserName = QUO_USERS[quoUserId] || quoUserId;
      console.log('Quo user:', quoUserName);
  
      // --- Create Lead Activity record ---
      const activityRes = await fetch(
        `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/Lead%20Activities`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              'Person': [personRecordId],
              'Activity': ['Call/email/text'],
              'Date of Activity': activityDate,
              'Notes': notes,
              'Quo User': quoUserName
            }
          })
        }
      );
  
      const activityData = await activityRes.json();
  
      if (activityData.error) {
        console.log('Airtable error:', JSON.stringify(activityData));
      } else {
        console.log('Created activity:', activityData.id);
      }
  
      return new Response('OK', { status: 200 });
    }
  };