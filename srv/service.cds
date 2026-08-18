using { itsm.master as master, itsm.transaction as txn } from '../db/schema';
 
@path: 'ITSMService'
@requires: 'authenticated-user'
service ITSMService {
 
    // Master Data
    entity LookupValues       as projection on master.LookupValue;

    // Used by the Message Processor dropdown, the client-filter join, and
    // to resolve a logged-in user's org/theme.
    entity Users              as projection on master.User;

    // Admin panel: organizations list + per-org theme/logo.
    entity Organizations      as projection on master.Organization;

    // Transaction Data
    entity Tickets            as projection on txn.Ticket;
    entity TicketLogs         as projection on txn.TicketLog;

    action ticketAction(ticketID : String, action: String) returns String;

    // Tells the frontend which persona the logged-in user is and (for an
    // End User whose org has a theme set) what colors/logo to apply.
    function currentUser() returns { persona: String; userName: String; theme: { themeType: String; themeScope: String; primaryColor: String; secondaryColor: String; logo: String; newTicketBtnColor: String; newTicketBtnTextColor: String; formBtnColor: String; formBtnTextColor: String; }; };

}
 