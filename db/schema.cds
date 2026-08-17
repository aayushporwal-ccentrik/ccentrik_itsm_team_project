namespace itsm;
 
using { cuid, managed } from '@sap/cds/common';
 
context transaction {
 
    entity Ticket : managed {
 
        key ticketID     : String;
 
        ticketNumber     : String;
        ticketType       : String;
 
        description     : String;
        status           : String;
        subStatus        : String;
 
        createdByName       : String;
        createdByLocation   : String;
        messageProcessor    : String;
        orgName             : String;
 
        incidentForm : Composition of one IncidentForm
            on incidentForm.ticketID = $self.ticketID;
           
        attachments : Composition of many Attachment
            on attachments.ticketID = $self.ticketID;

        ticketLogs : Composition of many TicketLog
            on ticketLogs.ticketID = $self.ticketID;
    }
 
    entity IncidentForm : cuid {
 
        ticketID : String;
 
        description : LargeString;
 
        category1 : String;
        category2 : String;
        category3 : String;
        category4 : String;
 
        impact : String;
        urgency : String;
        recommendedPriority : String;
        configurationItem : String;
    }
 
    entity Attachment : cuid, managed {
 
        @Core.ContentDisposition.Filename : fileName
        @Core.MediaType : mediaType
        content : LargeBinary;
 
        ticketID : String;
 
        mediaType   : String;
        fileName    : String;
        fileSize    : Integer;
        storagePath : String;
    }
 
    entity TicketLog : cuid, managed {
    ticketID        : String;     
    stage           : String;     
    status          : String;      
    userName        : String;     
    userEmail       : String;
    role            : String;     
    receivedDt      : DateTime;    
    completionDt    : DateTime;   
    pendingWith     : String;      
    pendingWithName : String;      
    remarks         : String(4000); 
    }
}
 
context master {
 
    entity LookupValue : cuid, managed {
 
        lookupType  : String;
        code        : String;
        name        : String;
        description : String;
        sequence    : Integer;
        isDefault   : Boolean;
        isActive    : Boolean;
    }
 
    entity TicketCounter : managed {
        key type : String;
        lastNumber : Integer;
    }
 
    entity User : cuid, managed {
        userId   : String;
        name     : String;
        email    : String;
        isActive : Boolean;
        role     : String;
    }
 
    entity OrganizationSLA : cuid, managed {
 
        organizationId : String;
        organizationName : String;
 
        impact : String;
        urgency : String;
        impactedUserFrom : Integer;
        impactedUserTo   : Integer;
        priority : String;
        firstResponseMinutes : Integer;
        resolutionMinutes    : Integer;
 
        isActive : Boolean;
    }
}
 
 