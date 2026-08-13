using { itsm.master as master, itsm.transaction as txn } from '../db/schema';
 
@path: 'ITSMService'
@requires: 'authenticated-user'
service ITSMService {
 
    // Master Data
    entity LookupValues       as projection on master.LookupValue;

    // Used to fill the Message Processor dropdown (Service Group picking
    // a Consultant to assign a ticket to).
    entity Users              as projection on master.User;
 
    // Transaction Data
    entity Tickets            as projection on txn.Ticket;

    // Tells the frontend which persona the logged-in user is, so the UI
    // can drive its role-based visibility model (see webapp/model/roleConfig.js).
    function currentUser() returns { persona: String; userName: String; };

}