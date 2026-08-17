using { itsm.master as master, itsm.transaction as txn } from '../db/schema';
 
@path: 'ITSMService'
@requires: 'authenticated-user'
service ITSMService {
 
    // Master Data
    entity LookupValues       as projection on master.LookupValue;

    // Used to fill the Message Processor dropdown (Service Group picking
    // a Consultant to assign a ticket to).
    entity Users              as projection on master.User;

    entity OrganizationSLAs   as projection on master.OrganizationSLA;
    entity Organizations      as projection on master.Organization;

    // Transaction Data
    // Main Tickets entity — role-based access control
    @restrict: [
        { grant: 'CREATE',       to: 'EndUser' },
        { grant: 'READ',         to: 'EndUser' },
        { grant: 'submitTicket', to: 'EndUser' },
        { grant: 'READ',         to: 'ServiceGroup' },
        { grant: 'UPDATE',       to: 'ServiceGroup' },
        { grant: 'assignTicket', to: 'ServiceGroup' },
        { grant: 'READ',         to: 'Consultant' },
        { grant: 'UPDATE',       to: 'Consultant' }
    ]
    entity Tickets            as projection on txn.Ticket
    actions {
        action submitTicket(ticketID : String) returns Tickets;
        action assignTicket(messageProcessor : String) returns Tickets;

        action ticketAction(ticketID : String, action: String) returns String;
    };
    // NEW — Service Group ka worklist: sirf submitted + unassigned tickets
    // Service Group ka Worklist — sirf submitted + unassigned tickets
    // (Service Group ka "Inbox Tray" — naye/unassigned tickets dekhne ke liye)
    @readonly
    @restrict: [
        { grant: 'READ', to: 'ServiceGroup' }
    ]
    entity ServiceGroupWorklist as projection on txn.Ticket
        where status = 'SUBMITTED' and messageProcessor is null;

    // Tells the frontend which persona/theme the logged-in user has, so the UI
    // can drive its role-based visibility model (see webapp/model/roleConfig.js).
    function currentUser() returns {
        persona: String;
        userName: String;
        theme: {
            themeType: String;
            themeScope: String;
            primaryColor: String;
            secondaryColor: String;
            logo: String;
        };
    };

}